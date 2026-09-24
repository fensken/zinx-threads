/**
 * Duration formatting + parsing for the timer and the timesheet.
 *
 * **Everything here takes and returns raw milliseconds.** Sums are computed on ms and
 * formatted exactly once, at the edge — `sum(round(x))` is not `round(sum(x))`, and a
 * timesheet whose day subtotals don't add up to its footer is one nobody trusts.
 *
 */

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

export interface DurationParts {
  hours: number
  minutes: number
  seconds: number
}

export function splitDuration(ms: number): DurationParts {
  const total = Math.max(0, Math.floor(ms / SECOND))
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60
  }
}

/** `01:23:45` — the running clock. Monospaced digits stop it jittering as it ticks. */
export function formatHms(ms: number): string {
  const { hours, minutes, seconds } = splitDuration(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/** `3h 05m` / `45m` — a logged amount, where seconds are noise. */
export function formatHm(ms: number): string {
  const total = Math.max(0, Math.round(ms / MINUTE))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

/** `3h` / `45m` / `1h 5m` — the tightest readable form, for chips and cards. */
export function formatCompact(ms: number): string {
  const total = Math.max(0, Math.round(ms / MINUTE))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/** Decimal hours to 2dp — what billing systems ingest, and what the CSV's `Hours` column
 *  carries beside the human `Duration`. */
export function decimalHours(ms: number): string {
  return (Math.max(0, ms) / HOUR).toFixed(2)
}

/*
 * There is deliberately no `parseDuration("1h 30m")` here.
 *
 * The duration field used to be one free-text box over a parser like that, and it was worse
 * than it looked: it read as `0m` until you typed something it recognised, gave no hint that
 * seconds existed, and turned a mistyped unit into a different number without complaint.
 * `timer/duration-input.tsx` now uses three labelled numeric segments (hh : mm : ss), matching
 * `common/time-field.tsx`. Nothing needs to guess at prose.
 *
 * (`convex/lib/timesheet.ts` keeps a `parseDurationArg` for the API surface, where an agent
 * genuinely does send `"1h30m"` as text. That one has no UI behind it.)
 */
