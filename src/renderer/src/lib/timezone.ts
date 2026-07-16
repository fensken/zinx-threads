/**
 * Time zones.
 *
 * **Every instant we store is a UTC epoch-ms number.** A zone is never baked into
 * a stored value — it's applied at render. That's the only way "the standup is at
 * 9am" can mean 9am in the workspace's zone to one person and 6:30pm to another,
 * and it's also what makes a future Google/Apple Calendar sync tractable (both
 * exchange instants + a zone, never wall-clock strings).
 *
 * Two zones are in play and they answer different questions:
 *  - the **workspace** zone — where the team's day is (an event is authored in it);
 *  - the **viewer's** zone — where you are (everything is also shown in it).
 * When they differ, surfaces show both. When they agree, showing both would be
 * noise, so they don't.
 */

/** The zone the browser/OS says we're in. Always available in practice; the `??`
 *  is for a hostile/locked-down environment, not a real one. */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Is this a zone the runtime actually knows? Guards a stored value: a zone that
 *  was valid when it was written can be renamed, and an unknown one makes every
 *  `Intl` call below throw. */
export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** Fall back to the viewer's own zone when a stored one is missing or unknown, so
 *  a null zone degrades to "as if it were mine" rather than to an error. */
export function safeZone(zone: string | null | undefined): string {
  return isValidTimeZone(zone) ? zone : detectTimeZone()
}

/** Every zone the runtime knows, for the picker. `supportedValuesOf` is ES2022 and
 *  present in Chromium/Electron; the fallback keeps the picker usable rather than
 *  empty if it ever isn't. */
export function allTimeZones(): string[] {
  const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf
  if (typeof supported === 'function') {
    try {
      return supported.call(Intl, 'timeZone')
    } catch {
      /* fall through */
    }
  }
  return [detectTimeZone(), 'UTC']
}

/** `America/New_York` → `America / New York` — the raw id is a machine string, and
 *  the underscores read as a typo. */
export function zoneLabel(zone: string): string {
  return zone.replace(/_/g, ' ').replace('/', ' / ')
}

/** The zone's current UTC offset, as `GMT-4` / `GMT+5:30`. Computed from `Intl`
 *  rather than a table, so DST is already applied. */
export function zoneOffsetLabel(zone: string, at: number = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset'
    }).formatToParts(new Date(at))
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

/** The clock time in a zone: `8:51 PM`. */
export function formatTimeInZone(at: number, zone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: safeZone(zone)
  }).format(new Date(at))
}

/** The date in a zone: `Fri, Jul 18`. `withYear` for anything not in this year. */
export function formatDateInZone(at: number, zone: string, withYear = false): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: safeZone(zone)
  }).format(new Date(at))
}

/** `Fri, Jul 18 · 9:00 AM` in a zone — a whole instant on one line. */
export function formatDateTimeInZone(at: number, zone: string, withYear = false): string {
  return `${formatDateInZone(at, zone, withYear)} · ${formatTimeInZone(at, zone)}`
}

/** Slack's profile line: `8:51 PM local time` — *their* clock, right now. */
export function localTimeLabel(zone: string, at: number = Date.now()): string {
  return `${formatTimeInZone(at, zone)} local time`
}

/** True when two zones are showing the same clock **right now**. Compared by their
 *  current offset, not their ids: `Europe/London` and `Europe/Dublin` are different
 *  zones that agree all year, and showing both times would be noise. (In the rare
 *  window where they diverge, they compare as different — which is correct.) */
export function sameClock(a: string, b: string, at: number = Date.now()): boolean {
  if (a === b) return true
  return formatTimeInZone(at, a) === formatTimeInZone(at, b)
}

/** The wall-clock parts of an instant **as seen in a zone** — the inverse of
 *  `zonedTimeToUtc` below, and what a date/time input has to be seeded with. */
export function partsInZone(
  at: number,
  zone: string
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(zone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(at))
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute')
  }
}

/**
 * Turn a **wall-clock** time in a zone into the UTC instant it names.
 *
 * "9:00 on Jul 18 in America/New_York" is a different instant from the same
 * wall-clock in Asia/Kolkata, and neither is what `new Date('2026-07-18T09:00')`
 * produces (that's the *browser's* zone). This is the conversion the event form
 * needs, and getting it wrong silently shifts every event by hours.
 *
 * There's no built-in inverse, so: guess the instant as if the wall-clock were UTC,
 * ask what that instant *looks like* in the zone, and correct by the difference.
 * One correction is enough except across a DST boundary, hence the second pass.
 */
export function zonedTimeToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  zone: string
): number {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  let guess = asUtc
  for (let i = 0; i < 2; i++) {
    const seen = partsInZone(guess, zone)
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute)
    const drift = asUtc - seenAsUtc
    if (drift === 0) break
    guess += drift
  }
  return guess
}

/** `2026-07-18` in a zone — the value an `<input type="date">` wants. */
export function dateInputValue(at: number, zone: string): string {
  const { year, month, day } = partsInZone(at, zone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** `09:00` in a zone — the value an `<input type="time">` wants. */
export function timeInputValue(at: number, zone: string): string {
  const { hour, minute } = partsInZone(at, zone)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** The inverse: `<input type="date">` + `<input type="time">` → the UTC instant that
 *  wall-clock names **in `zone`**. */
export function inputsToUtc(date: string, time: string, zone: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time || '00:00')
  if (!dateMatch || !timeMatch) return null
  return zonedTimeToUtc(
    {
      year: Number(dateMatch[1]),
      month: Number(dateMatch[2]),
      day: Number(dateMatch[3]),
      hour: Number(timeMatch[1]),
      minute: Number(timeMatch[2])
    },
    safeZone(zone)
  )
}
