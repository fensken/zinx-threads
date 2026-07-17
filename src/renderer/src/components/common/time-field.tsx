import * as React from 'react'

import { cn } from '@renderer/lib/utils'

type Period = 'AM' | 'PM'

/**
 * A 12-hour time input — two numeric fields (`hh` : `mm`) plus an AM/PM toggle,
 * hand-rolled so it reads the same on every OS (the native `<input type="time">`
 * looks and behaves differently on Windows vs macOS vs the web build, which was
 * half of why the old event form felt off). Value in/out is 24-hour `"HH:MM"`.
 */
export function TimeField({
  value,
  onChange,
  disabled,
  id,
  className
}: {
  /** Time as 24-hour `"HH:MM"` (e.g. `"09:00"` or `"14:30"`). */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
  className?: string
}): React.JSX.Element {
  const { h, m } = parse24(value)
  const { hour12, period } = to12(h)

  const [hourStr, setHourStr] = React.useState(String(hour12))
  const [minStr, setMinStr] = React.useState(pad2(m))

  // Reflect an externally-changed value (e.g. seeding on open) back into the fields —
  // React's render-time "adjust state when a prop changes" pattern, not an effect, so
  // the display is corrected in the same paint rather than a frame later.
  const [seenValue, setSeenValue] = React.useState(value)
  if (value !== seenValue) {
    setSeenValue(value)
    setHourStr(String(hour12))
    setMinStr(pad2(m))
  }

  const commit = (nextHour: string, nextMin: string, nextPeriod: Period): void => {
    const rawH = Number.parseInt(nextHour, 10)
    const rawM = Number.parseInt(nextMin, 10)
    const safeH = Number.isFinite(rawH) ? Math.min(12, Math.max(1, rawH || 12)) : hour12
    const safeM = Number.isFinite(rawM) ? Math.min(59, Math.max(0, rawM)) : m
    onChange(`${pad2(from12(safeH, nextPeriod))}:${pad2(safeM)}`)
  }

  const togglePeriod = (): void => {
    if (disabled) return
    commit(hourStr, minStr, period === 'AM' ? 'PM' : 'AM')
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-xs',
        'focus-within:ring-2 focus-within:ring-ring/50',
        disabled && 'opacity-60',
        className
      )}
    >
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={hourStr}
        onChange={(e) => setHourStr(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => commit(hourStr, minStr, period)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(hourStr, minStr, period)
          }
        }}
        onFocus={(e) => e.currentTarget.select()}
        disabled={disabled}
        aria-label="Hour"
        className="w-7 bg-transparent text-center tabular-nums outline-none disabled:cursor-not-allowed"
      />
      <span className="select-none text-muted-foreground">:</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={minStr}
        onChange={(e) => setMinStr(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => commit(hourStr, minStr, period)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(hourStr, minStr, period)
          }
        }}
        onFocus={(e) => e.currentTarget.select()}
        disabled={disabled}
        aria-label="Minute"
        className="w-7 bg-transparent text-center tabular-nums outline-none disabled:cursor-not-allowed"
      />
      <button
        type="button"
        onClick={togglePeriod}
        disabled={disabled}
        className={cn(
          'ml-1 grid h-6 w-9 place-items-center rounded text-xs font-semibold',
          'bg-muted text-foreground hover:bg-accent',
          disabled && 'cursor-not-allowed'
        )}
        aria-label={`Toggle AM/PM, currently ${period}`}
      >
        {period}
      </button>
    </div>
  )
}

function parse24(value: string): { h: number; m: number } {
  const [hStr, mStr] = value.split(':')
  const h = Math.min(23, Math.max(0, Number.parseInt(hStr, 10) || 0))
  const m = Math.min(59, Math.max(0, Number.parseInt(mStr, 10) || 0))
  return { h, m }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function to12(h: number): { hour12: number; period: Period } {
  if (h === 0) return { hour12: 12, period: 'AM' }
  if (h === 12) return { hour12: 12, period: 'PM' }
  if (h > 12) return { hour12: h - 12, period: 'PM' }
  return { hour12: h, period: 'AM' }
}

function from12(hour12: number, period: Period): number {
  if (period === 'AM') return hour12 === 12 ? 0 : hour12
  return hour12 === 12 ? 12 : hour12 + 12
}
