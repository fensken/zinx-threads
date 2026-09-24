import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'
import {
  MAX_TIMERS_PER_USER,
  STALE_TIMER_MS,
  computeElapsed,
  normalizeNote,
  requireTrackableTask
} from './lib/timesheet'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/**
 * The live stopwatch. One row per (user, task); at most one **running** at a time.
 *
 * Nothing here writes on a tick — elapsed is derived from `segmentStartedAt` +
 * `accumulatedMs` (see `lib/timesheet.ts` `computeElapsed`). The only writes are the seven
 * verbs below, all of which a human triggers.
 *
 * Stopping a timer lives in `timesheets.logTimer`, not here: it produces a ledger row, and
 * splitting the insert from the timer delete across two mutations would let them drift.
 */

/** How many rows the cron pauses per pass before rescheduling itself. */
const CRON_BATCH = 100

/** One row of `timer.mine`, enriched with the live task/channel names. */
interface TrackedTimer {
  _id: Id<'timerStates'>
  taskId: Id<'kanbanTasks'>
  channelId: Id<'channels'>
  taskTitle: string
  channelName: string
  status: Doc<'timerStates'>['status']
  elapsedMs: number
  note?: string
  autoPausedAt?: number
  autoPausedReason?: Doc<'timerStates'>['autoPausedReason']
}

async function requireOwnTimer(
  ctx: MutationCtx,
  timerId: Id<'timerStates'>
): Promise<{ timer: Doc<'timerStates'>; user: Doc<'users'> }> {
  const user = await requireUser(ctx)
  const timer = await ctx.db.get(timerId)
  if (!timer) throw new ConvexError('That timer is no longer running')
  if (timer.userId !== user._id) throw new ConvexError("That isn't your timer")
  // Re-check membership so losing access to the workspace stops every verb on a timer you
  // already own — not just the ones that start a new one.
  const membership = await getMembership(ctx, timer.workspaceId, user._id)
  if (!membership) throw new ConvexError('You are no longer a member of this workspace')
  return { timer, user }
}

/** Bank the current segment and stop the clock. Shared by pause / pauseForIdle / start. */
function pausePatch(
  timer: Doc<'timerStates'>,
  at: number,
  extra?: { autoPausedAt?: number; autoPausedReason?: Doc<'timerStates'>['autoPausedReason'] }
): Partial<Doc<'timerStates'>> {
  const segment = Math.max(0, at - timer.segmentStartedAt)
  return {
    status: 'paused' as const,
    accumulatedMs: timer.accumulatedMs + segment,
    // Moving this forward is what takes the row out of `by_status_segment`'s running
    // range, so the stale cron can't keep finding it.
    segmentStartedAt: at,
    ...extra
  }
}

/** Pause every OTHER running timer this person has — the single-running invariant. */
async function pauseAllRunning(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  userId: Id<'users'>,
  exceptId?: Id<'timerStates'>
): Promise<void> {
  const now = Date.now()
  const mine = await ctx.db
    .query('timerStates')
    .withIndex('by_workspace_user', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
    .take(MAX_TIMERS_PER_USER)
  for (const timer of mine) {
    if (timer._id === exceptId || timer.status !== 'running') continue
    await ctx.db.patch(timer._id, pausePatch(timer, now))
  }
}

/**
 * My timers in this workspace, newest segment first.
 *
 * Returns `serverNow` and a **server-computed** `elapsedMs` per timer. The client renders
 * `elapsedMs + (performance.now() - receivedAt)` rather than `Date.now() - segmentStartedAt`,
 * so a client clock that is minutes fast or slow — or that an NTP step moves mid-session —
 * can never make the displayed time wrong. Only the clock's *rate* matters.
 */
export const mine = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const now = Date.now()
    const user = await getCurrentUser(ctx)
    if (!user) return { serverNow: now, timers: [] }
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership) return { serverNow: now, timers: [] }

    const rows = await ctx.db
      .query('timerStates')
      .withIndex('by_workspace_user', (q) =>
        q.eq('workspaceId', workspaceId).eq('userId', user._id)
      )
      .take(MAX_TIMERS_PER_USER)

    const timers: TrackedTimer[] = []
    for (const timer of rows) {
      const task = await ctx.db.get(timer.taskId)
      // The task is gone (deleted while this was open). `cleanup.taskTime` will have dealt
      // with the row; just don't render a timer pointing at nothing.
      if (!task) continue
      const channel = await ctx.db.get(timer.channelId)
      timers.push({
        _id: timer._id,
        taskId: timer.taskId,
        channelId: timer.channelId,
        taskTitle: task.title,
        channelName: channel?.name ?? 'board',
        status: timer.status,
        elapsedMs: computeElapsed(timer, now),
        note: timer.note,
        autoPausedAt: timer.autoPausedAt,
        autoPausedReason: timer.autoPausedReason
      })
    }
    timers.sort((a, b) => (a.status === b.status ? 0 : a.status === 'running' ? -1 : 1))
    return { serverNow: now, timers }
  }
})

/** Start (or resume) tracking a task. Pauses whatever else was running. */
export const start = mutation({
  args: { taskId: v.id('kanbanTasks') },
  handler: async (ctx, { taskId }) => {
    const user = await requireUser(ctx)
    const { task, workspaceId } = await requireTrackableTask(ctx, user._id, taskId)
    const now = Date.now()

    await pauseAllRunning(ctx, workspaceId, user._id)

    const existing = await ctx.db
      .query('timerStates')
      .withIndex('by_workspace_user_task', (q) =>
        q.eq('workspaceId', workspaceId).eq('userId', user._id).eq('taskId', taskId)
      )
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: 'running',
        segmentStartedAt: now,
        autoPausedAt: undefined,
        autoPausedReason: undefined
      })
      return existing._id
    }

    const mineCount = await ctx.db
      .query('timerStates')
      .withIndex('by_workspace_user', (q) =>
        q.eq('workspaceId', workspaceId).eq('userId', user._id)
      )
      .take(MAX_TIMERS_PER_USER)
    if (mineCount.length >= MAX_TIMERS_PER_USER) {
      throw new ConvexError(
        `You have ${MAX_TIMERS_PER_USER} timers open — log or discard some first`
      )
    }

    return await ctx.db.insert('timerStates', {
      workspaceId,
      userId: user._id,
      taskId,
      channelId: task.channelId,
      status: 'running',
      segmentStartedAt: now,
      accumulatedMs: 0
    })
  }
})

/**
 * Pause the clock.
 *
 * `at` exists for the sleep/lock path: the renderer usually cannot complete a round-trip
 * before the machine suspends, and Convex holds the mutation in memory and flushes it on
 * resume — at which point a server-side `Date.now()` would credit the entire nap. Passing
 * the moment the machine went to sleep, clamped server-side, means a pause that lands eight
 * hours late still credits only up to that instant.
 */
export const pause = mutation({
  args: { timerId: v.id('timerStates'), at: v.optional(v.number()) },
  handler: async (ctx, { timerId, at }) => {
    const { timer } = await requireOwnTimer(ctx, timerId)
    if (timer.status !== 'running') return
    const now = Date.now()
    const clamped = Math.min(Math.max(at ?? now, timer.segmentStartedAt), now)
    await ctx.db.patch(timerId, pausePatch(timer, clamped))
  }
})

export const resume = mutation({
  args: { timerId: v.id('timerStates') },
  handler: async (ctx, { timerId }) => {
    const { timer, user } = await requireOwnTimer(ctx, timerId)
    if (timer.status === 'running') return
    await pauseAllRunning(ctx, timer.workspaceId, user._id, timerId)
    await ctx.db.patch(timerId, {
      status: 'running',
      segmentStartedAt: Date.now(),
      autoPausedAt: undefined,
      autoPausedReason: undefined
    })
  }
})

export const discard = mutation({
  args: { timerId: v.id('timerStates') },
  handler: async (ctx, { timerId }) => {
    await requireOwnTimer(ctx, timerId)
    await ctx.db.delete(timerId)
  }
})

export const setNote = mutation({
  args: { timerId: v.id('timerStates'), note: v.union(v.string(), v.null()) },
  handler: async (ctx, { timerId, note }) => {
    await requireOwnTimer(ctx, timerId)
    await ctx.db.patch(timerId, { note: normalizeNote(note) })
  }
})

/** Drop `trimMs` from the CURRENT segment without stopping the clock — "I was idle for 14
 *  minutes, don't count them, but I'm back now". Clamped to the segment so it can never
 *  produce negative time. */
export const trim = mutation({
  args: { timerId: v.id('timerStates'), trimMs: v.number() },
  handler: async (ctx, { timerId, trimMs }) => {
    const { timer } = await requireOwnTimer(ctx, timerId)
    if (timer.status !== 'running') return
    const now = Date.now()
    const segment = Math.max(0, now - timer.segmentStartedAt)
    const trimmed = Math.min(Math.max(0, Math.round(trimMs)), segment)
    await ctx.db.patch(timerId, { segmentStartedAt: timer.segmentStartedAt + trimmed })
  }
})

/**
 * Drop idle time AND stop the clock, in one atomic call.
 *
 * Deliberately not "trim then pause": on the sleep path those two round-trips would race
 * the machine suspending, and landing the first without the second credits the whole nap.
 */
export const pauseForIdle = mutation({
  args: {
    timerId: v.id('timerStates'),
    idleMs: v.number(),
    reason: v.union(v.literal('idle'), v.literal('sleep'), v.literal('lock'))
  },
  handler: async (ctx, { timerId, idleMs, reason }) => {
    const { timer } = await requireOwnTimer(ctx, timerId)
    if (timer.status !== 'running') return
    const now = Date.now()
    const segment = Math.max(0, now - timer.segmentStartedAt)
    const idle = Math.min(Math.max(0, Math.round(idleMs)), segment)
    await ctx.db.patch(timerId, {
      status: 'paused',
      accumulatedMs: timer.accumulatedMs + (segment - idle),
      segmentStartedAt: now,
      autoPausedAt: now,
      autoPausedReason: reason
    })
  }
})

/**
 * Pause timers left running past `STALE_TIMER_MS` and credit **exactly** that much, so a
 * clock forgotten on Friday can't invent the weekend.
 *
 * Reads an indexed range of only the forgotten rows. Pausing sets `status: 'paused'` and
 * moves `segmentStartedAt` to now, so the row leaves the range — which is what guarantees
 * the self-rescheduling batch makes progress instead of finding the same 100 rows forever,
 * and what stops a second pass double-crediting.
 */
export const autoPauseStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const cutoff = now - STALE_TIMER_MS
    const stale = await ctx.db
      .query('timerStates')
      .withIndex('by_status_segment', (q) =>
        q.eq('status', 'running').lt('segmentStartedAt', cutoff)
      )
      .take(CRON_BATCH)

    for (const timer of stale) {
      await ctx.db.patch(timer._id, {
        status: 'paused',
        accumulatedMs: timer.accumulatedMs + STALE_TIMER_MS,
        segmentStartedAt: now,
        autoPausedAt: now,
        autoPausedReason: 'stale'
      })
    }

    if (stale.length === CRON_BATCH) {
      await ctx.scheduler.runAfter(0, internal.timer.autoPauseStale, {})
    }
  }
})
