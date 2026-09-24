import { useMemo } from 'react'
import {
  DownloadSimple,
  PencilSimple,
  ArrowCounterClockwise,
  Trash,
  ClockCounterClockwise,
  Plus
} from '@phosphor-icons/react'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import { IconButton } from '@renderer/components/common/icon-button'
import { formatCompact, formatHm } from '@renderer/components/timer/format-duration'
import { groupByDay, sumMs } from '@renderer/components/timesheet/timesheet-buckets'
import { formatDateInZone, formatTimeInZone } from '@renderer/lib/timezone'
import type { TimeEntryRow } from '@renderer/components/timer/timer-types'
import { cn } from '@renderer/lib/utils'

/** The range presets. Values are plain strings so `Select` renders a LABEL, never the key. */
export const RANGE_PRESETS = {
  today: 'Today',
  'this-week': 'This week',
  'last-week': 'Last week',
  '30d': 'Last 30 days'
} as const
export type RangePreset = keyof typeof RANGE_PRESETS

const ALL_MEMBERS = '__all__'

export interface TimesheetViewProps {
  rows: TimeEntryRow[]
  loading?: boolean
  /** Truncated at the server's page size — say so rather than silently showing less. */
  hasMore?: boolean
  /** The workspace's zone. Days are the team's days, not the viewer's. */
  zone: string
  preset: RangePreset
  onPresetChange: (preset: RangePreset) => void
  /** Only passed when the viewer moderates this board — everyone else sees only their own
   *  hours, so a member filter would be a control with one possible value. */
  members?: { id: string; name: string }[]
  memberId?: string | null
  onMemberChange?: (memberId: string | null) => void
  billableOnly: boolean
  onBillableOnlyChange: (value: boolean) => void
  showDeleted: boolean
  onShowDeletedChange: (value: boolean) => void
  onExport: () => void
  onAddEntry?: () => void
  onEdit?: (row: TimeEntryRow) => void
  onDelete?: (row: TimeEntryRow) => void
  onRestore?: (row: TimeEntryRow) => void
  onHistory?: (row: TimeEntryRow) => void
  canManage?: (row: TimeEntryRow) => boolean
}

/**
 * The timesheet — one **board's** logged hours: filters, day-grouped rows, and totals.
 *
 * This is the second view of a kanban channel, beside the board itself. There is no board
 * filter because there is only ever one board in scope.
 *
 * Presentational: every filter is controlled and every action is a prop, so the same view
 * serves the Convex board and (later) the offline one. Mirrors `board-view.tsx`.
 */
export function TimesheetView({
  rows,
  loading,
  hasMore,
  zone,
  preset,
  onPresetChange,
  members,
  memberId,
  onMemberChange,
  billableOnly,
  onBillableOnlyChange,
  showDeleted,
  onShowDeletedChange,
  onExport,
  onAddEntry,
  onEdit,
  onDelete,
  onRestore,
  onHistory,
  canManage
}: TimesheetViewProps): React.JSX.Element {
  const groups = useMemo(() => groupByDay(rows, zone), [rows, zone])
  // Totals are summed from raw ms and formatted once — see `sumMs`.
  const totalMs = useMemo(() => sumMs(rows.filter((row) => !row.deletedAt)), [rows])
  const billableMs = useMemo(
    () => sumMs(rows.filter((row) => row.billable && !row.deletedAt)),
    [rows]
  )

  const memberItems = useMemo(
    () => ({
      [ALL_MEMBERS]: 'Everyone',
      ...Object.fromEntries((members ?? []).map((member) => [member.id, member.name]))
    }),
    [members]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        {/* The trigger renders the LABEL explicitly rather than leaving it to `SelectValue`.
            Base UI's fallback is to print the raw `value`, which would show "this-week" here
            and — worse — a user id in the member filter below. The app's hard rule is that an
            internal id never reaches the screen, so both triggers say what they mean. */}
        <Select
          value={preset}
          onValueChange={(value) => onPresetChange(value as RangePreset)}
          items={RANGE_PRESETS}
        >
          <SelectTrigger className="h-8 w-36">
            <span className="truncate">{RANGE_PRESETS[preset]}</span>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(RANGE_PRESETS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {members && onMemberChange ? (
          <Select
            value={memberId ?? ALL_MEMBERS}
            onValueChange={(value) => onMemberChange(value === ALL_MEMBERS ? null : value)}
            items={memberItems}
          >
            <SelectTrigger className="h-8 w-40">
              <span className="truncate">{memberItems[memberId ?? ALL_MEMBERS]}</span>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(memberItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Button
          size="sm"
          variant={billableOnly ? 'default' : 'outline'}
          onClick={() => onBillableOnlyChange(!billableOnly)}
        >
          Billable only
        </Button>
        <Button
          size="sm"
          variant={showDeleted ? 'default' : 'outline'}
          onClick={() => onShowDeletedChange(!showDeleted)}
        >
          Show removed
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onExport}>
            <DownloadSimple className="size-4" />
            Export CSV
          </Button>
          {onAddEntry ? (
            <Button size="sm" onClick={onAddEntry}>
              <Plus className="size-4" />
              Add time
            </Button>
          ) : null}
        </div>
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid gap-2 p-4">
            {[...Array(6)].map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-1 px-6 text-center">
            <ClockCounterClockwise className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No time logged in this range</p>
            <p className="text-xs text-muted-foreground">
              Start a timer on a board task, or add an entry by hand.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 p-4">
            {groups.map((group) => (
              <section key={group.key}>
                <div className="mb-1 flex items-baseline justify-between">
                  <h2 className="text-xs font-semibold text-muted-foreground">
                    {formatDateInZone(group.at, zone, true)}
                  </h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatHm(sumMs(group.rows.filter((row) => !row.deletedAt)))}
                  </span>
                </div>
                <div className="grid gap-1">
                  {group.rows.map((row) => (
                    <EntryRow
                      key={row.id}
                      row={row}
                      zone={zone}
                      canManage={canManage?.(row) ?? false}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onRestore={onRestore}
                      onHistory={onHistory}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <footer className="flex items-center gap-4 border-t px-4 py-2 text-xs">
        <span className="font-medium">
          Total <span className="tabular-nums">{formatHm(totalMs)}</span>
        </span>
        <span className="text-muted-foreground">
          Billable <span className="tabular-nums">{formatHm(billableMs)}</span>
        </span>
        <span className="text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
        </span>
        {hasMore ? (
          <span className="ml-auto text-muted-foreground">
            Showing the newest entries only — narrow the range to see the rest.
          </span>
        ) : null}
      </footer>
    </div>
  )
}

function EntryRow({
  row,
  zone,
  canManage,
  onEdit,
  onDelete,
  onRestore,
  onHistory
}: {
  row: TimeEntryRow
  zone: string
  canManage: boolean
  onEdit?: (row: TimeEntryRow) => void
  onDelete?: (row: TimeEntryRow) => void
  onRestore?: (row: TimeEntryRow) => void
  onHistory?: (row: TimeEntryRow) => void
}): React.JSX.Element {
  const removed = Boolean(row.deletedAt)
  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-accent/40',
        removed && 'opacity-60'
      )}
    >
      <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatTimeInZone(row.startedAt, zone)}
      </span>

      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm', removed && 'line-through')}>
          {/* A snapshot of a deleted task reads muted + italic — it's a record of something
              that no longer exists, not a link you can follow. */}
          <span className={cn(row.orphaned && 'italic text-muted-foreground')}>
            {row.taskTitle}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">#{row.channelName}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{row.userName}</span>
          {row.note ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{row.note}</span>
            </>
          ) : null}
        </span>
      </span>

      {row.billable ? (
        <Badge variant="secondary" className="shrink-0">
          Billable
        </Badge>
      ) : null}
      {row.source === 'manual' ? (
        <Badge variant="outline" className="shrink-0">
          Manual
        </Badge>
      ) : null}
      {row.edited && onHistory ? (
        <button
          type="button"
          onClick={() => onHistory(row)}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Edited ×{row.editCount}
        </button>
      ) : null}

      <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
        {formatCompact(row.durationMs)}
      </span>

      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {canManage && !removed && onEdit ? (
          <IconButton label="Edit" onClick={() => onEdit(row)}>
            <PencilSimple className="size-4" />
          </IconButton>
        ) : null}
        {canManage && !removed && onDelete ? (
          <IconButton label="Remove" onClick={() => onDelete(row)}>
            <Trash className="size-4" />
          </IconButton>
        ) : null}
        {canManage && removed && onRestore ? (
          <IconButton label="Restore" onClick={() => onRestore(row)}>
            <ArrowCounterClockwise className="size-4" />
          </IconButton>
        ) : null}
      </span>
    </div>
  )
}
