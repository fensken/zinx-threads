import type { Doc } from '../_generated/dataModel'

/**
 * Recurring-event expansion.
 *
 * A recurring event is a **single row**; its occurrences are expanded on read, never
 * materialised (mirrors zinx-os). The stepping is **timezone-aware**: a "9am daily"
 * event stays at 9am local across a DST boundary instead of drifting an hour, because
 * `Date.setDate/setMonth` operate in the *server's* zone. We extract the wall-clock in
 * the event's own zone, advance it, and converge back to UTC — pure stdlib, no dep.
 */

export type RepeatUnit = 'daily' | 'weekly' | 'monthly'

type ZonedParts = { y: number; mo: number; d: number; h: number; mi: number; s: number }

const PART_FMT_CACHE = new Map<string, Intl.DateTimeFormat>()
function getPartFmt(tz: string): Intl.DateTimeFormat {
  const hit = PART_FMT_CACHE.get(tz)
  if (hit) return hit
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  PART_FMT_CACHE.set(tz, fmt)
  return fmt
}

function safeTz(tz: string): string {
  try {
    getPartFmt(tz)
    return tz
  } catch {
    return 'UTC'
  }
}

function getZonedParts(d: Date, tz: string): ZonedParts {
  const parts = Object.fromEntries(
    getPartFmt(tz)
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  )
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour === '24' ? '00' : parts.hour),
    mi: Number(parts.minute),
    s: Number(parts.second)
  }
}

/** A `(y,mo,d,h,mi,s)` wall-clock reading taken in `tz` → the UTC instant. Iterates to
 *  converge because the same UTC interval reads as different wall-clocks across a DST
 *  transition. */
function dateFromZonedParts(p: ZonedParts, tz: string): Date {
  let utc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s)
  for (let i = 0; i < 3; i++) {
    const got = getZonedParts(new Date(utc), tz)
    const diffMs = (got.h - p.h) * 3_600_000 + (got.mi - p.mi) * 60_000 + (got.s - p.s) * 1_000
    if (diffMs === 0 && got.y === p.y && got.mo === p.mo && got.d === p.d) break
    utc -= diffMs
  }
  return new Date(utc)
}

/** Advance a Date by one day/week/month in `tz`, preserving the local wall-clock. */
export function addRepeatStep(from: Date, repeat: RepeatUnit, tz: string): Date {
  return advanceBy(from, repeat, tz, 1)
}

/** The occurrence **`n` steps** after `from`, on the tz-aware recurrence grid (equivalent
 *  to calling `addRepeatStep` `n` times, but O(1)). Used to fast-forward toward the range. */
function advanceBy(from: Date, repeat: RepeatUnit, tz: string, n: number): Date {
  const zone = safeTz(tz)
  const p = getZonedParts(from, zone)
  if (repeat === 'daily') return dateFromZonedParts({ ...p, d: p.d + n }, zone)
  if (repeat === 'weekly') return dateFromZonedParts({ ...p, d: p.d + 7 * n }, zone)
  // Monthly uses JS overflow semantics (Jan 31 + 1mo → Mar 3); standard calendar add.
  return dateFromZonedParts({ ...p, mo: p.mo + n }, zone)
}

/** The LONGEST possible span of one step (a 25h DST day, a 31-day month + slack). Dividing
 *  the gap by the LONGEST step yields the FEWEST steps to skip, so the estimate always
 *  UNDERshoots — `skip` real steps advance by at most `skip × LONGEST ≤ gap`, so the cursor
 *  can never jump PAST the first in-range occurrence; the align loop then walks the last few.
 *  (Dividing by the *shortest* step overshoots — it skips more than the range needs and drops
 *  the occurrences entirely, which a daily series years past its origin exposes.) */
const MAX_STEP_MS: Record<RepeatUnit, number> = {
  daily: 25 * 3_600_000,
  weekly: 7 * 25 * 3_600_000,
  monthly: 31 * 25 * 3_600_000
}

function isActiveRepeat(e: Doc<'events'>): e is Doc<'events'> & { repeat: RepeatUnit } {
  return e.repeat === 'daily' || e.repeat === 'weekly' || e.repeat === 'monthly'
}

export type EventInstance = { event: Doc<'events'>; startAt: number; endAt: number }

/** Expand one event into the occurrences that OVERLAP `[rangeFrom, rangeTo]`. A
 *  non-recurring event yields itself (if it overlaps); a recurring one yields each
 *  occurrence up to `repeatUntil` (or the range end).
 *
 *  **Fast-forwards to the range** instead of stepping from the series origin — a
 *  years-old daily series would otherwise cost thousands of DST-heavy steps per calendar
 *  open, and a fixed iteration cap would drop its *current* occurrences entirely. We
 *  estimate the whole steps to skip (undershooting via `MAX_STEP_MS`), jump on-grid with
 *  `advanceBy`, then align precisely — so the work scales with occurrences-IN-range. */
export function expandEventToRange(
  e: Doc<'events'>,
  rangeFrom: number,
  rangeTo: number,
  tz: string
): EventInstance[] {
  if (!isActiveRepeat(e)) {
    if (e.startAt > rangeTo || e.endAt < rangeFrom) return []
    return [{ event: e, startAt: e.startAt, endAt: e.endAt }]
  }

  const duration = Math.max(0, e.endAt - e.startAt)
  // `repeatUntil` names a DAY (midnight); a timed occurrence on that day starts later, so
  // extend the bound by ~a day (minus 1ms) to keep the final day's occurrence inclusive.
  const until = e.repeatUntil !== undefined ? e.repeatUntil + 24 * 3_600_000 - 1 : rangeTo
  const hardStop = Math.min(until, rangeTo)
  const occurrences: EventInstance[] = []

  // Fast-forward: an occurrence matters only if `occEnd >= rangeFrom`, i.e. its start is
  // `>= rangeFrom - duration`. Skip whole steps to near there (undershoot), then align.
  let cursor = new Date(e.startAt)
  const skip = Math.floor((rangeFrom - duration - e.startAt) / MAX_STEP_MS[e.repeat]) - 1
  if (skip > 0) cursor = advanceBy(cursor, e.repeat, tz, skip)

  let safety = 2000
  while (cursor.getTime() + duration < rangeFrom && cursor.getTime() <= hardStop && safety-- > 0) {
    cursor = addRepeatStep(cursor, e.repeat, tz)
  }

  safety = 2000
  while (cursor.getTime() <= hardStop && safety-- > 0) {
    const occStart = cursor.getTime()
    const occEnd = occStart + duration
    if (occEnd >= rangeFrom) occurrences.push({ event: e, startAt: occStart, endAt: occEnd })
    cursor = addRepeatStep(cursor, e.repeat, tz)
  }
  return occurrences
}
