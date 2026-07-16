import type { FunctionReturnType } from 'convex/server'
import type { api } from '@convex/_generated/api'
import { partsInZone, zonedTimeToUtc } from '@renderer/lib/timezone'

export type CalendarEvent = FunctionReturnType<typeof api.events.listRange>[number]

/** A day in the month grid, identified by its **wall-clock date in the workspace's
 *  zone** — never by a UTC timestamp. "Which day is this event on" has no answer
 *  until you say whose day you mean, and for a team calendar that's the team's. */
export interface GridDay {
  key: string
  day: number
  month: number
  year: number
  /** Midnight, and the next midnight, of this day *in the workspace's zone*. */
  startAt: number
  endAt: number
  inMonth: boolean
  isToday: boolean
}

/**
 * The 6×7 grid for a month, laid out in `zone`.
 *
 * Always six rows, so the calendar doesn't change height as you page through months
 * (a grid that grows a row in March is the thing every hand-rolled calendar gets
 * wrong).
 *
 * Two subtleties, each of which is a real bug avoided:
 *  - the day cells are built by **calendar arithmetic then converted**, not by adding
 *    86,400,000 ms repeatedly — across a DST boundary one day is 23 or 25 hours long,
 *    and the naive version silently drops or repeats a day;
 *  - "today" is decided in the workspace's zone (`partsInZone`), so the highlight is
 *    on the team's today.
 */
export function buildMonthGrid(year: number, month: number, zone: string, now: number): GridDay[] {
  // Which weekday the 1st falls on. Computed on a UTC date so it can't be shifted by
  // the browser's own zone — the grid's columns are a property of the calendar, not
  // of where the reader is sitting.
  const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() // 0 = Sunday

  const today = partsInZone(now, zone)
  const days: GridDay[] = []

  for (let i = 0; i < 42; i++) {
    const date = new Date(Date.UTC(year, month - 1, 1 + (i - leading)))
    const y = date.getUTCFullYear()
    const m = date.getUTCMonth() + 1
    const d = date.getUTCDate()

    const next = new Date(Date.UTC(y, m - 1, d + 1))
    const startAt = zonedTimeToUtc({ year: y, month: m, day: d, hour: 0, minute: 0 }, zone)
    const endAt = zonedTimeToUtc(
      {
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
        hour: 0,
        minute: 0
      },
      zone
    )

    days.push({
      key: `${y}-${m}-${d}`,
      day: d,
      month: m,
      year: y,
      startAt,
      endAt,
      inMonth: m === month && y === year,
      isToday: y === today.year && m === today.month && d === today.day
    })
  }
  return days
}
