import { partsInZone, safeZone, zonedTimeToUtc } from '@renderer/lib/timezone'

/**
 * Day and week boundaries for the timesheet, computed in the **workspace's** zone.
 *
 * Two rules, and both are load-bearing:
 *
 * 1. **A timesheet day is the team's day, not the viewer's.** Which day an entry belongs to
 *    is a question only one clock can answer, the same argument the calendar grid makes.
 *    Re-bucketing into each reader's zone would put the same hour on different days for
 *    different people, and their totals would disagree.
 *
 * 2. **Never add 86,400,000 ms to get to the next day.** One day a year is 23 hours and
 *    another is 25, so a fixed increment silently shifts every boundary after a DST change —
 *    dropping an hour of somebody's Sunday into Saturday twice a year. Every boundary here
 *    is computed by walking the *wall-clock date* and converting that back to an instant.
 */

/** A half-open range `[from, to]` of UTC instants (`to` is the last millisecond of the
 *  period, so it can be compared with `<=`). */
export interface Bounds {
  from: number
  to: number
}

/** Midnight at the start of the day `at` falls in, in `zone`. */
export function startOfDay(at: number, zone: string): number {
  const { year, month, day } = partsInZone(at, zone)
  return zonedTimeToUtc({ year, month, day, hour: 0, minute: 0 }, zone)
}

/**
 * Move a wall-clock date by `days` and return that date's midnight as an instant.
 * Calendar arithmetic via `Date.UTC`, which normalises month/year rollover for us, then a
 * fresh zone conversion — so the result is correct across a DST boundary.
 */
export function addDays(at: number, days: number, zone: string): number {
  const { year, month, day } = partsInZone(at, zone)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return zonedTimeToUtc(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: 0,
      minute: 0
    },
    zone
  )
}

/** The whole day `at` falls in. */
export function dayBounds(at: number, zone: string): Bounds {
  const safe = safeZone(zone)
  const from = startOfDay(at, safe)
  return { from, to: addDays(from, 1, safe) - 1 }
}

/** The Monday-start week `at` falls in. */
export function weekBounds(at: number, zone: string): Bounds {
  const safe = safeZone(zone)
  const dayStart = startOfDay(at, safe)
  const { year, month, day } = partsInZone(dayStart, safe)
  // `Date.UTC` on the wall-clock date gives the weekday without the zone interfering.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0 = Sunday
  const backToMonday = (weekday + 6) % 7
  const from = addDays(dayStart, -backToMonday, safe)
  return { from, to: addDays(from, 7, safe) - 1 }
}

/** The previous Monday-start week. */
export function lastWeekBounds(at: number, zone: string): Bounds {
  const safe = safeZone(zone)
  const thisWeek = weekBounds(at, safe)
  const from = addDays(thisWeek.from, -7, safe)
  return { from, to: thisWeek.from - 1 }
}

/** The last `days` days, ending at the end of today. */
export function trailingBounds(at: number, days: number, zone: string): Bounds {
  const safe = safeZone(zone)
  const today = dayBounds(at, safe)
  return { from: addDays(today.from, -(days - 1), safe), to: today.to }
}

/** A stable `YYYY-MM-DD` key for grouping rows into days, in the workspace's zone.
 *  Computed at read time rather than stored, so changing the workspace's zone re-buckets
 *  history consistently instead of leaving a mix of old and new keys. */
export function dayKey(at: number, zone: string): string {
  const { year, month, day } = partsInZone(at, safeZone(zone))
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Group entries into day buckets, newest day first, each keeping its own order. */
export function groupByDay<T extends { startedAt: number }>(
  rows: T[],
  zone: string
): { key: string; at: number; rows: T[] }[] {
  const safe = safeZone(zone)
  const buckets = new Map<string, { key: string; at: number; rows: T[] }>()
  for (const row of rows) {
    const key = dayKey(row.startedAt, safe)
    const bucket = buckets.get(key)
    if (bucket) bucket.rows.push(row)
    else buckets.set(key, { key, at: startOfDay(row.startedAt, safe), rows: [row] })
  }
  return [...buckets.values()].sort((a, b) => b.at - a.at)
}

/** Sum raw milliseconds. Deliberately not "sum of rounded values": `sum(round(x))` is not
 *  `round(sum(x))`, and a timesheet whose day subtotals don't add up to its footer is one
 *  nobody trusts. Format once, at the edge. */
export function sumMs<T extends { durationMs: number }>(rows: T[]): number {
  return rows.reduce((total, row) => total + row.durationMs, 0)
}
