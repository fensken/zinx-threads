/**
 * The shapes the presentational timer components speak.
 *
 * Deliberately free of Convex ids (ids are plain `string`s here), exactly like
 * `kanban/board-types.ts` — so the widget, the dialogs and the timesheet table can be
 * driven equally by Convex, by the local store, or by a test.
 */

export type TimerStatus = 'running' | 'paused'
export type AutoPauseReason = 'stale' | 'sleep' | 'lock' | 'idle'
export type TimeEntrySource = 'timer' | 'manual'

/** A live timer, as the widget renders it. */
export interface TrackedTimer {
  id: string
  taskId: string
  channelId: string
  taskTitle: string
  channelName: string
  status: TimerStatus
  /** Elapsed at the moment the data arrived — the widget adds the delta since. */
  elapsedMs: number
  note?: string
  autoPausedAt?: number
  autoPausedReason?: AutoPauseReason
}

/** A task you can start a timer on. */
export interface TimerTaskOption {
  taskId: string
  title: string
  channelName?: string
  estimateMs?: number
}

/** One committed row of the ledger. */
export interface TimeEntryRow {
  id: string
  taskId?: string
  channelId?: string
  userId: string
  taskTitle: string
  channelName: string
  userName: string
  /** Its task or board is gone — render the snapshot muted rather than as a live link. */
  orphaned: boolean
  startedAt: number
  durationMs: number
  trackedMs?: number
  source: TimeEntrySource
  billable: boolean
  note?: string
  edited: boolean
  editCount: number
  deletedAt?: number
}

/** One row of an entry's audit trail. */
export interface TimeEntryEdit {
  id: string
  editorName: string
  /** `create` is a **manual** entry's mandatory reason — time typed in by hand has no timer
   *  behind it, so why it exists is part of the record from the start. */
  kind: 'create' | 'edit' | 'delete' | 'restore'
  reason: string
  at: number
  changes: { field: string; before: string; after: string }[]
}

/** What the app learned about a gap in attention, and how it learned it.
 *
 *  `precision` is not decoration: on desktop we read the OS's own idle clock, on web we
 *  can only tell that the tab was hidden. The UI says which, because "your computer was
 *  idle for 20 minutes" and "you were away from this tab for 20 minutes" are different
 *  claims and only one of them is true in each case. */
export interface IdleReport {
  idleMs: number
  precision: 'system' | 'page'
  /** What ended the attention gap, when we know. */
  cause: 'idle' | 'sleep' | 'lock'
}
