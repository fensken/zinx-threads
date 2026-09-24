import * as React from 'react'
import { Label } from '@renderer/components/ui/label'
import { cn } from '@renderer/lib/utils'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/**
 * A duration as three numeric segments — `hh : mm : ss`.
 *
 * Built to match `common/time-field.tsx`: the same bordered segment group, the same
 * select-on-focus / commit-on-blur behaviour, the same hand-rolled numeric inputs rather
 * than a native control that looks different on every OS. A duration and a time-of-day are
 * the same *shape* of input, so they should not feel like two different widgets.
 *
 * This replaced a single free-text field that parsed `"1h 30m"`. Parsing prose was clever
 * and wrong: it left the field showing `0m` until you typed something it recognised, gave no
 * hint that seconds even existed, and made a mistyped unit silently mean something else.
 * Three labelled boxes can't be misread.
 *
 * Value in/out is **milliseconds**, so callers keep summing raw ms and formatting once.
 */
export function DurationInput({
  value,
  onChange,
  label,
  hint,
  autoFocus,
  showSeconds = true,
  disabled,
  className
}: {
  /** Current value in ms, or null when unset. */
  value: number | null
  onChange: (ms: number | null) => void
  label?: string
  hint?: string
  autoFocus?: boolean
  /** Seconds matter when stopping a timer; for a hand-typed estimate they're noise. */
  showSeconds?: boolean
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  const id = React.useId()
  const parts = splitParts(value ?? 0)

  const [hourStr, setHourStr] = React.useState(String(parts.hours))
  const [minStr, setMinStr] = React.useState(pad2(parts.minutes))
  const [secStr, setSecStr] = React.useState(pad2(parts.seconds))

  // Reflect an externally-changed value (seeding on open, or the tracked time landing) back
  // into the fields — React's render-time "adjust state when a prop changes" pattern, not an
  // effect, so the display is corrected in the same paint. Same as `TimeField`.
  const [seenValue, setSeenValue] = React.useState(value)
  if (value !== seenValue) {
    setSeenValue(value)
    setHourStr(String(parts.hours))
    setMinStr(pad2(parts.minutes))
    setSecStr(pad2(parts.seconds))
  }

  const commit = (nextHour: string, nextMin: string, nextSec: string): void => {
    const h = clamp(Number.parseInt(nextHour, 10), 0, 999)
    const m = clamp(Number.parseInt(nextMin, 10), 0, 59)
    const s = showSeconds ? clamp(Number.parseInt(nextSec, 10), 0, 59) : 0
    // Re-render the segments normalised (`75` minutes typed → `59`), so what's on screen is
    // always exactly what will be saved.
    setHourStr(String(h))
    setMinStr(pad2(m))
    setSecStr(pad2(s))
    const total = h * HOUR + m * MINUTE + s * SECOND
    onChange(total > 0 ? total : null)
  }

  const segment = (
    segmentValue: string,
    setSegment: (next: string) => void,
    ariaLabel: string,
    maxLength: number,
    focusFirst = false
  ): React.JSX.Element => (
    <input
      id={focusFirst ? id : undefined}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={maxLength}
      autoFocus={focusFirst && autoFocus}
      value={segmentValue}
      onChange={(event) => setSegment(event.target.value.replace(/[^0-9]/g, ''))}
      onBlur={() => commit(hourStr, minStr, secStr)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit(hourStr, minStr, secStr)
        }
      }}
      onFocus={(event) => event.currentTarget.select()}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'bg-transparent text-center tabular-nums outline-none disabled:cursor-not-allowed',
        maxLength > 2 ? 'w-9' : 'w-7'
      )}
    />
  )

  return (
    <div className={cn('grid gap-1.5', className)}>
      {label ? (
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
      ) : null}
      <div
        className={cn(
          'inline-flex w-fit items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-xs',
          'focus-within:ring-2 focus-within:ring-ring/50',
          disabled && 'opacity-60'
        )}
      >
        {segment(hourStr, setHourStr, 'Hours', 3, true)}
        <span className="select-none text-xs text-muted-foreground">h</span>
        <span className="select-none text-muted-foreground">:</span>
        {segment(minStr, setMinStr, 'Minutes', 2)}
        <span className="select-none text-xs text-muted-foreground">m</span>
        {showSeconds ? (
          <>
            <span className="select-none text-muted-foreground">:</span>
            {segment(secStr, setSecStr, 'Seconds', 2)}
            <span className="select-none text-xs text-muted-foreground">s</span>
          </>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function splitParts(ms: number): { hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.round(ms / SECOND))
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}
