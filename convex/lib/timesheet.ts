import { ConvexError } from 'convex/values'
import { requireChannelAccess } from './auth'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

/**
 * The shared core of time tracking.
 *
 * Every gate, bound and normalisation lives here so the public mutations (`timer.ts`,
 * `timesheets.ts`), the stale-timer cron and the developer-platform capabilities in
 * `apiTools.ts` all run ONE implementation. That is the whole reason the API surface
 * can't grow a second, weaker authorization path — the exact drift `canPostIn` was
 * created to prevent.
 */

/** A note is a sentence, not a document. */
export const NOTE_MAX = 1000
/** An edit reason has to actually say something, but isn't an essay. */
export const REASON_MIN = 3
export const REASON_MAX = 500
/** A single entry longer than a day is a typo, not a work session. */
export const DURATION_MIN_MS = 1000
export const DURATION_MAX_MS = 24 * 60 * 60 * 1000
/** Clock skew tolerance when a client sends a start time, and how far back a manual
 *  entry may be backdated. */
export const STARTED_AT_SKEW_MS = 5 * 60 * 1000
export const STARTED_AT_LOOKBACK_MS = 5 * 365 * 24 * 60 * 60 * 1000
/** One person's paused timers. Bounded because they're read as a list. */
export const MAX_TIMERS_PER_USER = 20
/** The timesheet page's page size. Past this the UI says "narrow the range" rather
 *  than silently truncating. */
export const LIST_MAX_ENTRIES = 500
/** The widget's today/week totals scan. */
export const TOTALS_SCAN_CAP = 400
/** Tasks per board — mirrors `boards.ts` MAX_TASKS. */
export const MAX_BOARD_TASKS = 500
/** Boards listed in the header's tracker. A workspace with more than this wants a search,
 *  not a longer list. */
export const MAX_TRACKABLE_BOARDS = 50
export const HISTORY_MAX = 100
/** A timer left running past this was forgotten, not worked. The cron credits exactly
 *  this much and no more, so a laptop shut at 6pm can't invent a day of hours. */
export const STALE_TIMER_MS = 12 * 60 * 60 * 1000
/** Below this, a timer stranded by a task deletion is noise — discard rather than log. */
export const MIN_AUTOLOG_MS = 60_000

// ── Elapsed ───────────────────────────────────────────────────────────────────

/** Live elapsed for a timer. The ONLY place this is derived — never stored. */
export function computeElapsed(timer: Doc<'timerStates'>, now: number): number {
  if (timer.status !== 'running') return timer.accumulatedMs
  return timer.accumulatedMs + Math.max(0, now - timer.segmentStartedAt)
}

// ── Normalisation ─────────────────────────────────────────────────────────────

export function normalizeNote(note: string | null | undefined): string | undefined {
  if (note === null || note === undefined) return undefined
  const trimmed = note.trim().slice(0, NOTE_MAX)
  return trimmed || undefined
}

/** Every edit and delete carries a reason. Enforced here, server-side, so the UI can't
 *  be the only thing insisting on it. */
export function normalizeReason(reason: string): string {
  const trimmed = reason.trim()
  if (trimmed.length < REASON_MIN) {
    throw new ConvexError(`Please say why — at least ${REASON_MIN} characters`)
  }
  return trimmed.slice(0, REASON_MAX)
}

export function normalizeDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) throw new ConvexError('That duration is not a number')
  const rounded = Math.round(durationMs)
  if (rounded < DURATION_MIN_MS) throw new ConvexError('That duration is too short to log')
  if (rounded > DURATION_MAX_MS) throw new ConvexError('A single entry can be at most 24 hours')
  return rounded
}

/** A UTC instant. Refuses the future (beyond clock skew) and the distant past — both are
 *  typos, and both would land the entry somewhere nobody will ever look at it. */
export function normalizeStartedAt(startedAt: number, now: number): number {
  if (!Number.isFinite(startedAt)) throw new ConvexError('That start time is not valid')
  if (startedAt > now + STARTED_AT_SKEW_MS)
    throw new ConvexError("You can't log time in the future")
  if (startedAt < now - STARTED_AT_LOOKBACK_MS)
    throw new ConvexError('That start time is too far in the past')
  return Math.round(startedAt)
}

/**
 * A human duration → ms. Accepts `"1h30m"`, `"1.5h"`, `"90m"`, `"1:30"`, or a bare number
 * of MINUTES. Used by the API capabilities so an agent can write what a person would.
 *
 * NB the renderer keeps its own copy in `components/timer/format-duration.ts` — two copies
 * on purpose, since the renderer cannot import from `convex/`.
 */
export function parseDurationArg(raw: string | number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) throw new ConvexError('That duration is not valid')
    return Math.round(raw * 60_000)
  }
  const text = raw.trim().toLowerCase()
  if (!text) throw new ConvexError('That duration is not valid')

  // `1:30` → 1h30m
  const clock = text.match(/^(\d+):([0-5]?\d)$/)
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * 60_000

  // `1h30m` / `1h` / `30m` / `1.5h`
  let ms = 0
  let matched = false
  for (const [, value, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*(h|m)/g)) {
    ms += Number(value) * (unit === 'h' ? 3_600_000 : 60_000)
    matched = true
  }
  if (matched) return Math.round(ms)

  // A bare number means minutes.
  const bare = Number(text)
  if (Number.isFinite(bare) && bare > 0) return Math.round(bare * 60_000)
  throw new ConvexError(`Couldn't read "${raw}" as a duration — try "1h30m" or "90m"`)
}

/** `3h 05m` — for the human-readable before/after columns in the audit trail. */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`
}

// ── Gates ─────────────────────────────────────────────────────────────────────

export interface TrackableTask {
  task: Doc<'kanbanTasks'>
  channel: Doc<'channels'>
  workspaceId: Id<'workspaces'>
  membership: Doc<'workspaceMembers'>
}

/**
 * May this person log time against this task?
 *
 * Deliberately reuses `canPost` rather than inventing a permission: a time entry is
 * content attached to a board and it feeds that board's rollup, so the people who may
 * write to a board are exactly the people who may bill against it. Routing through the
 * existing invariant means a new write path physically cannot forget the check.
 *
 * Guests are refused outright — a guest has no `workspaceMembers` row, so there is no
 * member to snapshot a name from and no workspace timesheet for the row to belong to.
 */
export async function requireTrackableTask(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  taskId: Id<'kanbanTasks'>
): Promise<TrackableTask> {
  const task = await ctx.db.get(taskId)
  if (!task) throw new ConvexError('Task not found')
  const access = await requireChannelAccess(ctx, task.channelId, userId)
  if (access.channel.kind !== 'kanban') throw new ConvexError('That channel is not a board')
  if (access.via !== 'owner' || !access.membership) {
    throw new ConvexError('Guests cannot track time in this workspace')
  }
  if (!access.canPost) throw new ConvexError('This board is read-only for you')
  return {
    task,
    channel: access.channel,
    workspaceId: access.workspaceId,
    membership: access.membership
  }
}

/*
 * NOTE — there is deliberately no `visibleKanbanChannelIds` helper here any more.
 *
 * An earlier design had the timesheet workspace-wide, which meant every read had to filter
 * out boards the caller couldn't see, or a moderator would learn the task titles of every
 * private board through somebody else's hours. That filter was the most error-prone part of
 * the feature: one query that forgot it was a leak.
 *
 * The timesheet is now a **view of one kanban channel**, so `getChannelAccess` on that
 * channel is the whole gate and the leak is not possible to write. Keep it that way — if a
 * cross-board report is ever wanted it needs the filter back, deliberately and with tests,
 * rather than as a quiet widening of an existing query.
 */
// (removed — see the note above)

/** The name to freeze onto an entry: their workspace nickname, else their account name,
 *  else the local part of their email. Matches how the member list resolves a name. */
export function snapshotUserName(membership: Doc<'workspaceMembers'>, user: Doc<'users'>): string {
  return (
    membership.displayName?.trim() || user.name?.trim() || user.email?.split('@')[0] || 'Member'
  )
}

// ── Rollup ────────────────────────────────────────────────────────────────────

export interface TotalsDelta {
  loggedMs: number
  billableMs: number
  entryCount: number
}

/**
 * Move a task's logged-time rollup by a delta. Upserts, clamps at zero, and — importantly
 * — **skips a no-op patch**: re-writing the same value still re-notifies every subscriber
 * of that board's rollup query, the same trap behind `pages.saveContent` and
 * `markChannelRead`.
 *
 * No-ops entirely when the entry has no task (its task was deleted; the entry survives via
 * its snapshot, but there is no longer a total to move).
 */
export async function bumpTaskTotals(
  ctx: MutationCtx,
  entry: { taskId?: Id<'kanbanTasks'>; channelId?: Id<'channels'>; workspaceId: Id<'workspaces'> },
  delta: TotalsDelta
): Promise<void> {
  if (!entry.taskId || !entry.channelId) return
  if (delta.loggedMs === 0 && delta.billableMs === 0 && delta.entryCount === 0) return

  const existing = await ctx.db
    .query('taskTimeTotals')
    .withIndex('by_task', (q) => q.eq('taskId', entry.taskId!))
    .unique()

  if (!existing) {
    await ctx.db.insert('taskTimeTotals', {
      taskId: entry.taskId,
      channelId: entry.channelId,
      workspaceId: entry.workspaceId,
      loggedMs: Math.max(0, delta.loggedMs),
      billableMs: Math.max(0, delta.billableMs),
      entryCount: Math.max(0, delta.entryCount)
    })
    return
  }

  const next = {
    loggedMs: Math.max(0, existing.loggedMs + delta.loggedMs),
    billableMs: Math.max(0, existing.billableMs + delta.billableMs),
    entryCount: Math.max(0, existing.entryCount + delta.entryCount)
  }
  if (
    next.loggedMs === existing.loggedMs &&
    next.billableMs === existing.billableMs &&
    next.entryCount === existing.entryCount
  ) {
    return
  }
  await ctx.db.patch(existing._id, next)
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export interface FieldChange {
  field: string
  before: string
  after: string
}

/** Append one row to the audit trail. The editor's name is snapshotted so the trail still
 *  reads correctly after they leave the workspace. */
export async function recordEdit(
  ctx: MutationCtx,
  args: {
    entry: Doc<'timesheetEntries'>
    editorId: Id<'users'>
    editorName: string
    kind: 'create' | 'edit' | 'delete' | 'restore'
    reason: string
    changes: FieldChange[]
  }
): Promise<void> {
  await ctx.db.insert('timesheetEntryEdits', {
    workspaceId: args.entry.workspaceId,
    entryId: args.entry._id,
    editorId: args.editorId,
    editorName: args.editorName,
    kind: args.kind,
    reason: args.reason,
    at: Date.now(),
    changes: args.changes
  })
}
