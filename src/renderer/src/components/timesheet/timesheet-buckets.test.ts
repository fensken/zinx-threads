import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayBounds,
  dayKey,
  groupByDay,
  lastWeekBounds,
  startOfDay,
  sumMs,
  weekBounds
} from '@renderer/components/timesheet/timesheet-buckets'

const HOUR = 3_600_000
const NY = 'America/New_York'
const KOLKATA = 'Asia/Kolkata'

/**
 * The DST tests are the point of this file. They're written against a specific date —
 * 2026-03-08, when New York springs forward — because the bug they guard is invisible for
 * 363 days a year and then silently moves an hour of someone's Sunday into Saturday.
 */
describe('day bounds across a DST change', () => {
  it('makes the spring-forward day 23 hours, not 24', () => {
    // 2026-03-08 12:00 in New York, expressed as a UTC instant.
    const noon = Date.UTC(2026, 2, 8, 16, 0)
    const { from, to } = dayBounds(noon, NY)
    const lengthHours = (to + 1 - from) / HOUR
    expect(lengthHours).toBe(23)
  })

  it('makes the fall-back day 25 hours', () => {
    // 2026-11-01, when New York falls back.
    const noon = Date.UTC(2026, 10, 1, 16, 0)
    const { from, to } = dayBounds(noon, NY)
    expect((to + 1 - from) / HOUR).toBe(25)
  })

  it('makes the week containing a spring-forward 167 hours', () => {
    const noon = Date.UTC(2026, 2, 8, 16, 0)
    const { from, to } = weekBounds(noon, NY)
    expect((to + 1 - from) / HOUR).toBe(167)
  })

  it('keeps a late-evening entry on its own day', () => {
    // 23:30 local on the day the clocks changed. A `+86_400_000` boundary would land this
    // in the wrong bucket.
    const lateEvening = Date.UTC(2026, 2, 9, 3, 30) // 2026-03-08 23:30 in New York
    expect(dayKey(lateEvening, NY)).toBe('2026-03-08')
    const { from, to } = dayBounds(lateEvening, NY)
    expect(lateEvening).toBeGreaterThanOrEqual(from)
    expect(lateEvening).toBeLessThanOrEqual(to)
  })

  it('steps whole calendar days, not fixed 24h increments', () => {
    const start = startOfDay(Date.UTC(2026, 2, 6, 17, 0), NY) // Fri 2026-03-06
    // Four steps forward crosses the change; each landing must still be local midnight.
    for (let i = 0; i <= 4; i++) {
      const at = addDays(start, i, NY)
      expect(dayKey(at, NY)).toBe(dayKey(at + 60_000, NY))
      expect(startOfDay(at, NY)).toBe(at)
    }
    // …and the naive arithmetic would have been an hour off by then.
    expect(addDays(start, 4, NY)).not.toBe(start + 4 * 24 * HOUR)
  })
})

describe('bucketing is done in the workspace zone', () => {
  it('puts the same instant on different days in different zones', () => {
    // 2026-07-20 21:00 New York == 2026-07-21 06:30 Kolkata.
    const at = Date.UTC(2026, 6, 21, 1, 0)
    expect(dayKey(at, NY)).toBe('2026-07-20')
    expect(dayKey(at, KOLKATA)).toBe('2026-07-21')
  })

  it('handles a half-hour offset zone', () => {
    const { from, to } = dayBounds(Date.UTC(2026, 6, 21, 6, 0), KOLKATA)
    expect((to + 1 - from) / HOUR).toBe(24)
    expect(dayKey(from, KOLKATA)).toBe('2026-07-21')
  })

  it('starts the week on Monday', () => {
    // 2026-07-22 is a Wednesday.
    const wednesday = Date.UTC(2026, 6, 22, 16, 0)
    const { from } = weekBounds(wednesday, NY)
    expect(dayKey(from, NY)).toBe('2026-07-20') // the Monday
    expect(dayKey(lastWeekBounds(wednesday, NY).from, NY)).toBe('2026-07-13')
  })

  it('leaves no gap between last week and this week', () => {
    const wednesday = Date.UTC(2026, 6, 22, 16, 0)
    expect(lastWeekBounds(wednesday, NY).to + 1).toBe(weekBounds(wednesday, NY).from)
  })
})

describe('grouping and totals', () => {
  it('groups newest day first and keeps every row', () => {
    const rows = [
      { startedAt: Date.UTC(2026, 6, 20, 16, 0), durationMs: HOUR },
      { startedAt: Date.UTC(2026, 6, 20, 19, 0), durationMs: 2 * HOUR },
      { startedAt: Date.UTC(2026, 6, 22, 16, 0), durationMs: HOUR }
    ]
    const groups = groupByDay(rows, NY)
    expect(groups.map((group) => group.key)).toEqual(['2026-07-22', '2026-07-20'])
    expect(groups[1].rows).toHaveLength(2)
    expect(groups.flatMap((group) => group.rows)).toHaveLength(rows.length)
  })

  it('sums raw milliseconds so subtotals match the footer', () => {
    // Three values that each round to 20m but sum to 59m59s — rounding first would report
    // an hour and make the day subtotals disagree with the total.
    const rows = [
      { durationMs: 20 * 60_000 - 1 },
      { durationMs: 20 * 60_000 },
      { durationMs: 20 * 60_000 }
    ]
    expect(sumMs(rows)).toBe(60 * 60_000 - 1)
  })
})
