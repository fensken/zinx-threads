import { useCallback, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { errorMessage } from '@renderer/lib/convex-error'
import { useNow } from '@renderer/lib/use-now'
import { TimesheetView, type RangePreset } from '@renderer/components/timesheet/timesheet-view'
import {
  EditEntryDialog,
  EntryHistoryDialog,
  ReasonDialog
} from '@renderer/components/timesheet/entry-dialogs'
import { ManualEntryDialog } from '@renderer/components/timesheet/manual-entry-dialog'
import { downloadTimesheetCsv } from '@renderer/components/timesheet/timesheet-csv'
import {
  dayBounds,
  lastWeekBounds,
  trailingBounds,
  weekBounds
} from '@renderer/components/timesheet/timesheet-buckets'
import type { TimeEntryRow } from '@renderer/components/timer/timer-types'

/**
 * Convex adapter for **one board's** timesheet — the second view of a kanban channel.
 *
 * Everything is scoped to `channelId`, which is what makes `getChannelAccess` the entire
 * authorization story: there is no cross-board read here that could reach a private board.
 */
export function RealTimesheetView({
  channelId,
  channelName,
  zone
}: {
  channelId: Id<'channels'>
  channelName: string
  /** The workspace's zone — a timesheet day is the team's day. */
  zone: string
}): React.JSX.Element {
  const [preset, setPreset] = useState<RangePreset>('this-week')
  const [memberId, setMemberId] = useState<Id<'users'> | null>(null)
  const [billableOnly, setBillableOnly] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<TimeEntryRow | null>(null)
  const [removing, setRemoving] = useState<TimeEntryRow | null>(null)
  const [restoring, setRestoring] = useState<TimeEntryRow | null>(null)
  const [historyFor, setHistoryFor] = useState<TimeEntryRow | null>(null)

  // `useNow`, not `Date.now()`: reading the clock during render is impure, and this makes
  // "Today" roll over on its own rather than at whatever re-render happens to come next.
  const now = useNow().getTime()
  const range = useMemo(() => {
    switch (preset) {
      case 'today':
        return dayBounds(now, zone)
      case 'last-week':
        return lastWeekBounds(now, zone)
      case '30d':
        return trailingBounds(now, 30, zone)
      default:
        return weekBounds(now, zone)
    }
  }, [now, preset, zone])

  const data = useQuery(api.timesheets.listByChannel, {
    channelId,
    from: range.from,
    to: range.to,
    userId: memberId ?? undefined,
    billableOnly: billableOnly || undefined,
    includeDeleted: showDeleted || undefined
  })
  const canModerate = data?.canModerate ?? false
  const viewerId = data?.viewerId
  const contributors = useQuery(api.timesheets.contributors, canModerate ? { channelId } : 'skip')
  const tasks = useQuery(api.timesheets.taskOptions, adding ? { channelId } : 'skip')
  const edits = useQuery(
    api.timesheets.history,
    historyFor ? { entryId: historyFor.id as Id<'timesheetEntries'> } : 'skip'
  )

  const createEntry = useMutation(api.timesheets.create)
  const updateEntry = useMutation(api.timesheets.update)
  const removeEntry = useMutation(api.timesheets.remove)
  const restoreEntry = useMutation(api.timesheets.restore)

  const guard = useCallback(async (promise: Promise<unknown>, fallback: string): Promise<void> => {
    try {
      await promise
    } catch (error) {
      toast.error(errorMessage(error, fallback))
      throw error
    }
  }, [])

  const rows: TimeEntryRow[] = useMemo(
    () =>
      (data?.rows ?? []).map((row) => ({
        id: row._id,
        taskId: row.taskId,
        channelId: row.channelId,
        userId: row.userId,
        taskTitle: row.taskTitle,
        channelName: row.channelName,
        userName: row.userName,
        orphaned: row.orphaned,
        startedAt: row.startedAt,
        durationMs: row.durationMs,
        trackedMs: row.trackedMs,
        source: row.source,
        billable: row.billable,
        note: row.note,
        edited: row.edited,
        editCount: row.editCount,
        deletedAt: row.deletedAt
      })),
    [data]
  )

  return (
    <>
      <TimesheetView
        rows={rows}
        loading={data === undefined}
        hasMore={data?.hasMore}
        zone={zone}
        preset={preset}
        onPresetChange={setPreset}
        members={
          canModerate
            ? (contributors ?? []).map((person) => ({ id: person.userId, name: person.name }))
            : undefined
        }
        memberId={memberId}
        onMemberChange={canModerate ? (id) => setMemberId(id as Id<'users'> | null) : undefined}
        billableOnly={billableOnly}
        onBillableOnlyChange={setBillableOnly}
        showDeleted={showDeleted}
        onShowDeletedChange={setShowDeleted}
        onExport={() => downloadTimesheetCsv(rows, zone, `timesheet-${channelName}.csv`)}
        onAddEntry={() => setAdding(true)}
        onEdit={setEditing}
        onDelete={setRemoving}
        onRestore={setRestoring}
        onHistory={setHistoryFor}
        // Your own rows always; anyone's when you moderate this board. The server re-checks,
        // so this only decides whether to render the affordance.
        canManage={(row) => canModerate || row.userId === viewerId}
      />

      <ManualEntryDialog
        open={adding}
        onOpenChange={setAdding}
        zone={zone}
        tasks={(tasks ?? []).map((task) => ({
          taskId: task._id,
          title: task.title,
          estimateMs: task.estimateMs
        }))}
        loadingTasks={adding && tasks === undefined}
        onSubmit={async (args) => {
          await guard(
            createEntry({ ...args, taskId: args.taskId as Id<'kanbanTasks'> }),
            'Could not add the entry'
          )
        }}
      />

      <EditEntryDialog
        row={editing}
        zone={zone}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onSubmit={async (args) => {
          if (!editing) return
          await guard(
            updateEntry({ entryId: editing.id as Id<'timesheetEntries'>, ...args }),
            'Could not save the change'
          )
          setEditing(null)
        }}
      />

      <ReasonDialog
        row={removing}
        mode="delete"
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        onSubmit={async (reason) => {
          if (!removing) return
          await guard(
            removeEntry({ entryId: removing.id as Id<'timesheetEntries'>, reason }),
            'Could not remove the entry'
          )
          setRemoving(null)
        }}
      />

      <ReasonDialog
        row={restoring}
        mode="restore"
        onOpenChange={(open) => {
          if (!open) setRestoring(null)
        }}
        onSubmit={async (reason) => {
          if (!restoring) return
          await guard(
            restoreEntry({ entryId: restoring.id as Id<'timesheetEntries'>, reason }),
            'Could not restore the entry'
          )
          setRestoring(null)
        }}
      />

      <EntryHistoryDialog
        row={historyFor}
        zone={zone}
        loading={historyFor !== null && edits === undefined}
        edits={(edits ?? []).map((edit) => ({
          id: edit._id,
          editorName: edit.editorName,
          kind: edit.kind,
          reason: edit.reason,
          at: edit.at,
          changes: edit.changes
        }))}
        onOpenChange={(open) => {
          if (!open) setHistoryFor(null)
        }}
      />
    </>
  )
}
