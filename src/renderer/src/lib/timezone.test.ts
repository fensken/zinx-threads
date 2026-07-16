import { describe, expect, it } from 'vitest'
import { buildMonthGrid } from '@renderer/lib/calendar-grid'
import { dateInputValue, inputsToUtc, partsInZone, zonedTimeToUtc } from '@renderer/lib/timezone'

// The conversion between a wall-clock in a zone and the UTC instant it names is the
// one piece of this feature that fails *silently* — get it wrong and every event is
// simply a few hours off, with nothing to notice until someone misses a meeting.

describe('zonedTimeToUtc', () => {
  it('reads a wall-clock in the zone it was typed in, not the runtime’s', () => {
    // 09:00 on 2026-07-20 in New York is EDT (UTC-4) → 13:00 UTC.
    expect(
      zonedTimeToUtc({ year: 2026, month: 7, day: 20, hour: 9, minute: 0 }, 'America/New_York')
    ).toBe(Date.UTC(2026, 6, 20, 13, 0))

    // The same wall-clock in Kolkata (UTC+5:30) is a completely different instant.
    expect(
      zonedTimeToUtc({ year: 2026, month: 7, day: 20, hour: 9, minute: 0 }, 'Asia/Kolkata')
    ).toBe(Date.UTC(2026, 6, 20, 3, 30))

    // And in UTC it's itself.
    expect(zonedTimeToUtc({ year: 2026, month: 7, day: 20, hour: 9, minute: 0 }, 'UTC')).toBe(
      Date.UTC(2026, 6, 20, 9, 0)
    )
  })

  it('applies the right offset either side of a DST boundary', () => {
    // US DST ends 2026-11-01. Oct 31 is EDT (-4); Nov 2 is EST (-5). The same 09:00
    // therefore maps to two different UTC hours — a fixed offset would get one wrong.
    const before = zonedTimeToUtc(
      { year: 2026, month: 10, day: 31, hour: 9, minute: 0 },
      'America/New_York'
    )
    const after = zonedTimeToUtc(
      { year: 2026, month: 11, day: 2, hour: 9, minute: 0 },
      'America/New_York'
    )
    expect(before).toBe(Date.UTC(2026, 9, 31, 13, 0))
    expect(after).toBe(Date.UTC(2026, 10, 2, 14, 0))
  })

  it('round-trips: an instant → its parts in a zone → back to the instant', () => {
    const instant = Date.UTC(2026, 6, 20, 13, 0)
    const parts = partsInZone(instant, 'America/New_York')
    expect(parts).toMatchObject({ year: 2026, month: 7, day: 20, hour: 9, minute: 0 })
    expect(zonedTimeToUtc(parts, 'America/New_York')).toBe(instant)
  })
})

describe('inputsToUtc', () => {
  it('turns the form’s date + time fields into the instant they name in the zone', () => {
    expect(inputsToUtc('2026-07-20', '09:00', 'America/New_York')).toBe(
      Date.UTC(2026, 6, 20, 13, 0)
    )
    expect(inputsToUtc('2026-07-20', '09:00', 'Asia/Kolkata')).toBe(Date.UTC(2026, 6, 20, 3, 30))
  })

  it('returns null for a malformed field rather than a wrong instant', () => {
    expect(inputsToUtc('', '09:00', 'UTC')).toBeNull()
    expect(inputsToUtc('20/07/2026', '09:00', 'UTC')).toBeNull()
  })
})

describe('buildMonthGrid', () => {
  it('is always 6 weeks, so the calendar never changes height', () => {
    for (const month of [1, 2, 6, 12]) {
      expect(buildMonthGrid(2026, month, 'UTC', Date.UTC(2026, 6, 20))).toHaveLength(42)
    }
  })

  it('buckets days by the WORKSPACE’s zone, not UTC', () => {
    const grid = buildMonthGrid(2026, 7, 'America/New_York', Date.UTC(2026, 6, 20, 13))
    const first = grid.find((day) => day.inMonth && day.day === 1)!
    // July 1st in New York *starts* at 04:00 UTC (EDT is UTC-4) — not at UTC midnight.
    expect(first.startAt).toBe(Date.UTC(2026, 6, 1, 4, 0))
    expect(dateInputValue(first.startAt, 'America/New_York')).toBe('2026-07-01')
  })

  it('marks today in the workspace’s zone', () => {
    // 01:00 UTC on Jul 21 is still Jul 20 in New York — "today" must be the team's.
    const grid = buildMonthGrid(2026, 7, 'America/New_York', Date.UTC(2026, 6, 21, 1, 0))
    const today = grid.find((day) => day.isToday)!
    expect(today.day).toBe(20)
  })
})
