import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { getChannelAccess, getCurrentUser, getMembership, requireUser } from './lib/auth'
import { getMyChannelIds, visibleChannels } from './lib/channelMembers'
import { listRealChannels } from './lib/channels'
import { rateLimiter } from './rateLimiter'
import {
  HISTORY_MAX,
  LIST_MAX_ENTRIES,
  MAX_BOARD_TASKS,
  MAX_TRACKABLE_BOARDS,
  TOTALS_SCAN_CAP,
  bumpTaskTotals,
  computeElapsed,
  fmtDuration,
  normalizeDuration,
  normalizeNote,
  normalizeReason,
  normalizeStartedAt,
  recordEdit,
  requireTrackableTask,
  snapshotUserName,
  type FieldChange
} from './lib/timesheet'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/**
 * The time ledger for **kanban channels** — committed entries, their audit trail, and the
 * reads the timesheet view and the board rollups are built from.
 *
 * Three rules run through everything here:
 *  - **Everything is scoped to one channel.** The timesheet is the second view of a kanban
 *    channel, so `getChannelAccess` is the whole authorization story and a private board's
 *    hours cannot be reached from outside it. See the note in `lib/timesheet.ts`.
 *  - **Hours are not destroyed while the board exists.** Deletes are soft and reversible,
 *    a deleted task keeps its logged hours (they render from a snapshot), and every change
 *    records who made it and why. Deleting the *channel* does take its hours with it —
 *    nothing could display them afterwards, and the confirmation says so.
 *  - **The server stores instants, never wall-clock.** All day/week bucketing happens in the
 *    renderer against the workspace's zone — the rule `events.ts` already states.
 */

/** Resolve who may act on an entry: yourself always, or a moderator of its board. */
async function requireEntryAccess(
  ctx: MutationCtx | QueryCtx,
  entryId: Id<'timesheetEntries'>
): Promise<{ entry: Doc<'timesheetEntries'>; user: Doc<'users'>; canManage: boolean }> {
  const user = await requireUser(ctx)
  const entry = await ctx.db.get(entryId)
  if (!entry) throw new ConvexError('That time entry no longer exists')
  const membership = await getMembership(ctx, entry.workspaceId, user._id)
  if (!membership) throw new ConvexError('You are not a member of this workspace')

  if (entry.userId === user._id) return { entry, user, canManage: true }

  // Someone else's hours. Moderating the board they were logged against is what grants it;
  // if the board is gone, workspace owner/admin is the fallback.
  let canManage = membership.role === 'owner' || membership.role === 'admin'
  if (entry.channelId) {
    const access = await getChannelAccess(ctx, entry.channelId, user._id)
    canManage = access?.canModerate ?? canManage
  }
  if (!canManage) throw new ConvexError('You can only change your own time entries')
  return { entry, user, canManage }
}

/** Shape one entry for the client, preferring live documents so renames propagate and
 *  falling back to the snapshot when the reference is gone. */
async function enrichEntry(
  ctx: QueryCtx,
  entry: Doc<'timesheetEntries'>
): Promise<{
  _id: Id<'timesheetEntries'>
  taskId?: Id<'kanbanTasks'>
  channelId?: Id<'channels'>
  userId: Id<'users'>
  taskTitle: string
  channelName: string
  userName: string
  /** True when the task or board it points at is gone — the UI renders the snapshot muted. */
  orphaned: boolean
  startedAt: number
  durationMs: number
  trackedMs?: number
  source: Doc<'timesheetEntries'>['source']
  billable: boolean
  note?: string
  edited: boolean
  editCount: number
  deletedAt?: number
}> {
  const task = entry.taskId ? await ctx.db.get(entry.taskId) : null
  const channel = entry.channelId ? await ctx.db.get(entry.channelId) : null
  const user = await ctx.db.get(entry.userId)
  return {
    _id: entry._id,
    taskId: entry.taskId,
    channelId: entry.channelId,
    userId: entry.userId,
    taskTitle: task?.title ?? entry.taskTitle,
    channelName: channel?.name ?? entry.channelName,
    userName: user?.name ?? entry.userName,
    orphaned: !task || !channel,
    startedAt: entry.startedAt,
    durationMs: entry.durationMs,
    trackedMs: entry.trackedMs,
    source: entry.source,
    billable: entry.billable === true,
    note: entry.note,
    edited: entry.edited === true,
    editCount: entry.editCount ?? 0,
    deletedAt: entry.deletedAt
  }
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Stop a running timer and commit it as an entry.
 *
 * `trackedMs` is computed **server-side** from the timer row — a client that could send it
 * could invent hours. `durationMs` may differ (you round 52 minutes up to an hour); both are
 * kept, forever, so the gap is a visible fact rather than a silent overwrite.
 */
export const logTimer = mutation({
  args: {
    timerId: v.id('timerStates'),
    durationMs: v.optional(v.number()),
    note: v.optional(v.union(v.string(), v.null())),
    billable: v.optional(v.boolean())
  },
  handler: async (ctx, { timerId, durationMs, note, billable }) => {
    const user = await requireUser(ctx)
    const timer = await ctx.db.get(timerId)
    if (!timer) throw new ConvexError('That timer is no longer running')
    if (timer.userId !== user._id) throw new ConvexError("That isn't your timer")

    const { task, channel, workspaceId, membership } = await requireTrackableTask(
      ctx,
      user._id,
      timer.taskId
    )
    await rateLimiter.limit(ctx, 'logTime', { key: user._id, throws: true })

    const now = Date.now()
    const trackedMs = computeElapsed(timer, now)
    const finalMs = normalizeDuration(durationMs ?? trackedMs)
    // Where the work started: the timer's first segment, clamped into the row's own lifetime
    // so a trimmed or auto-paused timer can't claim a start before it existed.
    const startedAt = Math.min(Math.max(now - trackedMs, timer._creationTime), now)

    const entryId = await ctx.db.insert('timesheetEntries', {
      workspaceId,
      channelId: channel._id,
      taskId: task._id,
      userId: user._id,
      taskTitle: task.title,
      channelName: channel.name,
      userName: snapshotUserName(membership, user),
      startedAt,
      durationMs: finalMs,
      trackedMs,
      source: 'timer',
      billable,
      note: normalizeNote(note ?? timer.note)
    })

    await bumpTaskTotals(
      ctx,
      { taskId: task._id, channelId: channel._id, workspaceId },
      { loggedMs: finalMs, billableMs: billable ? finalMs : 0, entryCount: 1 }
    )
    await ctx.db.delete(timerId)
    return entryId
  }
})

/**
 * Log time by hand — for work done away from the app.
 *
 * **The reason is mandatory**, and that is the difference between this and stopping a timer.
 * A timer-logged entry carries its own evidence: the clock ran, and `trackedMs` records what
 * it measured. Hours typed in afterwards have nothing behind them except the word of the
 * person typing, so the record has to include why. It goes into the same append-only trail
 * as edits and deletions, as `kind: 'create'`.
 */
export const create = mutation({
  args: {
    taskId: v.id('kanbanTasks'),
    startedAt: v.number(),
    durationMs: v.number(),
    reason: v.string(),
    note: v.optional(v.union(v.string(), v.null())),
    billable: v.optional(v.boolean())
  },
  handler: async (ctx, { taskId, startedAt, durationMs, reason, note, billable }) => {
    const user = await requireUser(ctx)
    const { task, channel, workspaceId, membership } = await requireTrackableTask(
      ctx,
      user._id,
      taskId
    )
    await rateLimiter.limit(ctx, 'logTime', { key: user._id, throws: true })

    // Validate the reason BEFORE inserting, so a rejected entry leaves nothing behind.
    const cleanReason = normalizeReason(reason)
    const finalMs = normalizeDuration(durationMs)
    const entryId = await ctx.db.insert('timesheetEntries', {
      workspaceId,
      channelId: channel._id,
      taskId: task._id,
      userId: user._id,
      taskTitle: task.title,
      channelName: channel.name,
      userName: snapshotUserName(membership, user),
      startedAt: normalizeStartedAt(startedAt, Date.now()),
      durationMs: finalMs,
      source: 'manual',
      billable,
      note: normalizeNote(note)
    })

    await bumpTaskTotals(
      ctx,
      { taskId: task._id, channelId: channel._id, workspaceId },
      { loggedMs: finalMs, billableMs: billable ? finalMs : 0, entryCount: 1 }
    )

    const entry = await ctx.db.get(entryId)
    if (entry) {
      await recordEdit(ctx, {
        entry,
        editorId: user._id,
        editorName: snapshotUserName(membership, user),
        kind: 'create',
        reason: cleanReason,
        changes: [{ field: 'duration', before: '—', after: fmtDuration(finalMs) }]
      })
    }
    return entryId
  }
})

/** Change an entry. The reason is mandatory and lands in the audit trail with field-level
 *  before/after — a timesheet whose numbers can move without explanation isn't a record. */
export const update = mutation({
  args: {
    entryId: v.id('timesheetEntries'),
    durationMs: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    note: v.optional(v.union(v.string(), v.null())),
    billable: v.optional(v.boolean()),
    reason: v.string()
  },
  handler: async (ctx, { entryId, durationMs, startedAt, note, billable, reason }) => {
    const { entry, user } = await requireEntryAccess(ctx, entryId)
    if (entry.deletedAt) throw new ConvexError('Restore this entry before editing it')
    const cleanReason = normalizeReason(reason)

    const patch: Partial<Doc<'timesheetEntries'>> = {}
    const changes: FieldChange[] = []

    if (durationMs !== undefined) {
      const next = normalizeDuration(durationMs)
      if (next !== entry.durationMs) {
        patch.durationMs = next
        changes.push({
          field: 'duration',
          before: fmtDuration(entry.durationMs),
          after: fmtDuration(next)
        })
      }
    }
    if (startedAt !== undefined) {
      const next = normalizeStartedAt(startedAt, Date.now())
      if (next !== entry.startedAt) {
        patch.startedAt = next
        changes.push({
          field: 'started',
          before: new Date(entry.startedAt).toISOString(),
          after: new Date(next).toISOString()
        })
      }
    }
    if (note !== undefined) {
      const next = normalizeNote(note)
      if (next !== entry.note) {
        patch.note = next
        changes.push({ field: 'note', before: entry.note ?? '—', after: next ?? '—' })
      }
    }
    if (billable !== undefined && billable !== (entry.billable === true)) {
      patch.billable = billable
      changes.push({
        field: 'billable',
        before: entry.billable === true ? 'yes' : 'no',
        after: billable ? 'yes' : 'no'
      })
    }

    // Nothing actually changed — write nothing at all. A no-op patch still re-notifies
    // every subscriber, and an audit row saying "changed nothing" is noise in a record
    // people are meant to be able to read.
    if (changes.length === 0) return

    const wasBillable = entry.billable === true
    const nowBillable = patch.billable ?? wasBillable
    const oldMs = entry.durationMs
    const newMs = patch.durationMs ?? oldMs

    await ctx.db.patch(entryId, {
      ...patch,
      edited: true,
      editCount: (entry.editCount ?? 0) + 1
    })
    await bumpTaskTotals(ctx, entry, {
      loggedMs: newMs - oldMs,
      billableMs: (nowBillable ? newMs : 0) - (wasBillable ? oldMs : 0),
      entryCount: 0
    })
    await recordEdit(ctx, {
      entry,
      editorId: user._id,
      editorName: user.name ?? user.email ?? 'Member',
      kind: 'edit',
      reason: cleanReason,
      changes
    })
  }
})

/** Soft-delete. The row stays, struck through and explained; only a workspace delete ever
 *  removes it for real. */
export const remove = mutation({
  args: { entryId: v.id('timesheetEntries'), reason: v.string() },
  handler: async (ctx, { entryId, reason }) => {
    const { entry, user } = await requireEntryAccess(ctx, entryId)
    if (entry.deletedAt) return
    const cleanReason = normalizeReason(reason)

    await ctx.db.patch(entryId, { deletedAt: Date.now() })
    await bumpTaskTotals(ctx, entry, {
      loggedMs: -entry.durationMs,
      billableMs: entry.billable === true ? -entry.durationMs : 0,
      entryCount: -1
    })
    await recordEdit(ctx, {
      entry,
      editorId: user._id,
      editorName: user.name ?? user.email ?? 'Member',
      kind: 'delete',
      reason: cleanReason,
      changes: [{ field: 'duration', before: fmtDuration(entry.durationMs), after: 'removed' }]
    })
  }
})

/** Undo a soft delete. A delete with no way back is a trap wearing safety goggles. */
export const restore = mutation({
  args: { entryId: v.id('timesheetEntries'), reason: v.string() },
  handler: async (ctx, { entryId, reason }) => {
    const { entry, user } = await requireEntryAccess(ctx, entryId)
    if (!entry.deletedAt) return
    const cleanReason = normalizeReason(reason)

    await ctx.db.patch(entryId, { deletedAt: undefined })
    await bumpTaskTotals(ctx, entry, {
      loggedMs: entry.durationMs,
      billableMs: entry.billable === true ? entry.durationMs : 0,
      entryCount: 1
    })
    await recordEdit(ctx, {
      entry,
      editorId: user._id,
      editorName: user.name ?? user.email ?? 'Member',
      kind: 'restore',
      reason: cleanReason,
      changes: [{ field: 'duration', before: 'removed', after: fmtDuration(entry.durationMs) }]
    })
  }
})

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * One board's timesheet.
 *
 * **Always channel-scoped**, because the timesheet is a *view of a kanban channel* — the
 * second tab beside the board. That isn't just a UI decision: it means `getChannelAccess` is
 * the entire gate, so a private board's hours cannot reach someone outside it by
 * construction, rather than by a filter somebody has to remember to apply. (An earlier
 * workspace-wide version needed exactly such a filter, and it was the single most
 * error-prone part of this feature.)
 *
 * Within the board: you always see your own hours; you see everyone's only if you moderate
 * it. `canModerate` is owner/admin of the host workspace, the same rule that governs pinning
 * and deleting other people's messages.
 */
export const listByChannel = query({
  args: {
    channelId: v.id('channels'),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    userId: v.optional(v.id('users')),
    taskId: v.optional(v.id('kanbanTasks')),
    billableOnly: v.optional(v.boolean()),
    includeDeleted: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    if (!user) return { rows: [], hasMore: false, canModerate: false }
    const access = await getChannelAccess(ctx, args.channelId, user._id)
    if (!access || access.channel.kind !== 'kanban') {
      return { rows: [], hasMore: false, canModerate: false }
    }

    // Only a moderator may look at anyone else's hours; everyone else is pinned to their own.
    const scopedUserId = access.canModerate ? args.userId : user._id

    const raw = args.taskId
      ? await ctx.db
          .query('timesheetEntries')
          .withIndex('by_task', (q) => q.eq('taskId', args.taskId))
          .order('desc')
          .take(LIST_MAX_ENTRIES)
      : await ctx.db
          .query('timesheetEntries')
          .withIndex('by_channel_started', (q) => {
            const base = q.eq('channelId', args.channelId)
            return args.from !== undefined ? base.gte('startedAt', args.from) : base
          })
          .order('desc')
          .take(LIST_MAX_ENTRIES)

    const filtered = raw.filter((entry) => {
      if (entry.channelId !== args.channelId) return false
      if (!args.includeDeleted && entry.deletedAt) return false
      if (args.billableOnly && entry.billable !== true) return false
      if (args.from !== undefined && entry.startedAt < args.from) return false
      if (args.to !== undefined && entry.startedAt > args.to) return false
      if (scopedUserId && entry.userId !== scopedUserId) return false
      return true
    })

    const rows = await Promise.all(filtered.map((entry) => enrichEntry(ctx, entry)))
    return {
      rows,
      hasMore: raw.length === LIST_MAX_ENTRIES,
      canModerate: access.canModerate,
      viewerId: user._id
    }
  }
})

/** My today / this-week totals **on this board**, for the timer panel. Ranges arrive as UTC
 *  instants the renderer computed in the workspace's zone. */
export const myTotals = query({
  args: {
    channelId: v.id('channels'),
    todayFrom: v.number(),
    todayTo: v.number(),
    weekFrom: v.number(),
    weekTo: v.number()
  },
  handler: async (ctx, { channelId, todayFrom, todayTo, weekFrom, weekTo }) => {
    const empty = { todayMs: 0, weekMs: 0, capped: false }
    const user = await getCurrentUser(ctx)
    if (!user) return empty
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access || access.channel.kind !== 'kanban') return empty

    const from = Math.min(weekFrom, todayFrom)
    const to = Math.max(weekTo, todayTo)
    const rows = await ctx.db
      .query('timesheetEntries')
      .withIndex('by_channel_started', (q) => q.eq('channelId', channelId).gte('startedAt', from))
      .take(TOTALS_SCAN_CAP)

    let todayMs = 0
    let weekMs = 0
    for (const entry of rows) {
      // Bounded set already — filtering the other members out in JS costs nothing and
      // avoids an index that would only ever serve this one query.
      if (entry.userId !== user._id || entry.deletedAt || entry.startedAt > to) continue
      if (entry.startedAt >= todayFrom && entry.startedAt <= todayTo) todayMs += entry.durationMs
      if (entry.startedAt >= weekFrom && entry.startedAt <= weekTo) weekMs += entry.durationMs
    }
    return { todayMs, weekMs, capped: rows.length === TOTALS_SCAN_CAP }
  }
})

/** One board's per-task totals. A SEPARATE query from `boards.getByChannel` on purpose —
 *  folding it in would put every timer stop on the board's invalidation path. */
export const rollupsForChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access || access.channel.kind !== 'kanban') return []
    return await ctx.db
      .query('taskTimeTotals')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(MAX_BOARD_TASKS)
  }
})

/** One task's recent entries + its total — the task dialog's Time section. */
export const taskTime = query({
  args: { taskId: v.id('kanbanTasks') },
  handler: async (ctx, { taskId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return { entries: [], totals: null }
    const task = await ctx.db.get(taskId)
    if (!task) return { entries: [], totals: null }
    const access = await getChannelAccess(ctx, task.channelId, user._id)
    if (!access) return { entries: [], totals: null }

    const raw = await ctx.db
      .query('timesheetEntries')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .order('desc')
      .take(50)
    const totals = await ctx.db
      .query('taskTimeTotals')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .unique()
    const entries = await Promise.all(
      raw.filter((entry) => !entry.deletedAt).map((entry) => enrichEntry(ctx, entry))
    )
    return { entries, totals }
  }
})

/** The audit trail for one entry. */
export const history = query({
  args: { entryId: v.id('timesheetEntries') },
  handler: async (ctx, { entryId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const entry = await ctx.db.get(entryId)
    if (!entry) return []
    const membership = await getMembership(ctx, entry.workspaceId, user._id)
    if (!membership) return []
    const isModerator = membership.role === 'owner' || membership.role === 'admin'
    if (entry.userId !== user._id && !isModerator) return []

    return await ctx.db
      .query('timesheetEntryEdits')
      .withIndex('by_entry', (q) => q.eq('entryId', entryId))
      .order('desc')
      .take(HISTORY_MAX)
  }
})

/**
 * This board's tasks, for the "start a timer" / "log time" pickers.
 *
 * There is no cross-board picker any more: time tracking lives *inside* a kanban channel, so
 * the board is already chosen by where you are. That also sidesteps the query that would
 * otherwise be unavoidable — `kanbanTasks.assigneeIds` is an array and Convex cannot index
 * array membership, so "every task assigned to me across every board" would mean reading
 * every board in full.
 */
export const taskOptions = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access || access.channel.kind !== 'kanban' || !access.canPost) return []
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(MAX_BOARD_TASKS)
    return tasks.map((task) => ({ _id: task._id, title: task.title, estimateMs: task.estimateMs }))
  }
})

/**
 * The kanban boards in this workspace the caller can see — what the app header uses to
 * decide whether to offer time tracking at all, and to jump to a board.
 *
 * Returns only channel **names**, never hours or task titles: exactly the data the sidebar
 * already shows this person, filtered by the same `visibleChannels` rule, so this is not a
 * way around the per-channel gate on the timesheet itself.
 */
export const trackableBoards = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership) return []

    const boards = (await listRealChannels(ctx, workspaceId)).filter(
      (channel) => channel.kind === 'kanban'
    )
    const mine = await getMyChannelIds(ctx, workspaceId, user._id)
    return visibleChannels(boards, membership.role, mine)
      .slice(0, MAX_TRACKABLE_BOARDS)
      .map((channel) => ({ _id: channel._id, name: channel.name }))
  }
})

/** The members who have logged time on this board — the timesheet's member filter. Derived
 *  from the entries themselves rather than the roster, so it lists exactly the people the
 *  filter can actually match. Moderators only; everyone else sees just their own hours. */
export const contributors = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access || access.channel.kind !== 'kanban' || !access.canModerate) return []

    const rows = await ctx.db
      .query('timesheetEntries')
      .withIndex('by_channel_started', (q) => q.eq('channelId', channelId))
      .order('desc')
      .take(LIST_MAX_ENTRIES)

    const seen = new Map<string, { userId: Id<'users'>; name: string }>()
    for (const entry of rows) {
      const key = entry.userId as string
      if (seen.has(key)) continue
      const member = await ctx.db.get(entry.userId)
      seen.set(key, { userId: entry.userId, name: member?.name ?? entry.userName })
    }
    return [...seen.values()]
  }
})
