import { downloadCsv } from '@renderer/lib/database-csv'
import { decimalHours, formatHm } from '@renderer/components/timer/format-duration'
import { dayKey } from '@renderer/components/timesheet/timesheet-buckets'
import { formatTimeInZone } from '@renderer/lib/timezone'
import type { TimeEntryRow } from '@renderer/components/timer/timer-types'

/**
 * The timesheet as CSV.
 *
 * Two decisions that matter to whoever opens this in a spreadsheet:
 *
 * - **Dates and times are formatted in the WORKSPACE's zone**, not UTC and not the
 *   exporter's. A 9pm Pacific entry exported as a UTC date lands on the following day, and
 *   that is exactly the discrepancy an accountant finds first.
 * - **Both `Duration` and `Hours` are emitted.** `3h 05m` is what a person checks; `3.08` is
 *   what a billing system ingests. Providing only one guarantees somebody converts by hand.
 */

function escapeCell(value: string): string {
  // Quote anything containing a delimiter, a quote or a newline, doubling inner quotes.
  if (/["\n\r,]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

const COLUMNS = [
  'Date',
  'Start',
  'Member',
  'Board',
  'Task',
  'Duration',
  'Hours',
  'Billable',
  'Source',
  'Tracked',
  'Edited',
  'Deleted',
  'Note'
] as const

export function entriesToCsv(rows: TimeEntryRow[], zone: string): string {
  const lines = [COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(
      [
        dayKey(row.startedAt, zone),
        formatTimeInZone(row.startedAt, zone),
        row.userName,
        row.channelName,
        row.taskTitle,
        formatHm(row.durationMs),
        decimalHours(row.durationMs),
        row.billable ? 'yes' : 'no',
        row.source,
        row.trackedMs === undefined ? '' : formatHm(row.trackedMs),
        row.edited ? String(row.editCount) : '',
        row.deletedAt ? 'yes' : '',
        row.note ?? ''
      ]
        .map((cell) => escapeCell(String(cell)))
        .join(',')
    )
  }
  // CRLF: what Excel expects, and harmless everywhere else.
  return lines.join('\r\n')
}

/** Build and download the file. Reuses `database-csv.ts` `downloadCsv`, which already
 *  prefixes the UTF-8 BOM Excel needs to read accented names correctly. */
export function downloadTimesheetCsv(
  rows: TimeEntryRow[],
  zone: string,
  filename = 'timesheet.csv'
): void {
  downloadCsv(filename, entriesToCsv(rows, zone))
}
