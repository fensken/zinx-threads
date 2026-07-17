import * as React from 'react'
import { CalendarBlank } from '@phosphor-icons/react'

import { Button } from '@renderer/components/ui/button'
import { Calendar } from '@renderer/components/ui/calendar'
import { Label } from '@renderer/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { TimeField } from '@renderer/components/common/time-field'
import { cn } from '@renderer/lib/utils'
import { detectTimeZone, partsInZone, zonedTimeToUtc } from '@renderer/lib/timezone'

/**
 * A date-and-time picker — a calendar in a popover plus a 12-hour time field.
 *
 * **The wall-clock is interpreted in `timeZone`, not the browser's.** "9:00 AM on
 * the 5th" maps to that instant in the workspace's zone, so an event agrees for
 * everyone regardless of where they're sitting — the one conversion a naive
 * `new Date(value)` gets silently wrong. Ported from zinx-os and adapted to this
 * app's timezone helpers (`partsInZone` / `zonedTimeToUtc`).
 *
 * `value` is the true UTC instant as a `Date`; its wall-clock is only ever shown
 * *through* `timeZone`.
 */
const CURRENT_YEAR = new Date().getFullYear()
const FIRST_YEAR = CURRENT_YEAR - 5
const LAST_YEAR = CURRENT_YEAR + 10

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/** value → label maps for the month/year jump dropdowns (Base UI `Select` renders the
 *  LABEL, never the raw value — the "no ids on screen" rule, applied to plain numbers). */
const MONTH_ITEMS: Record<string, string> = Object.fromEntries(
  MONTH_NAMES.map((name, i) => [String(i), name])
)
const YEAR_ITEMS: Record<string, string> = Object.fromEntries(
  Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => {
    const year = FIRST_YEAR + i
    return [String(year), String(year)]
  })
)

export function DateTimePicker({
  id,
  value,
  onChange,
  disabled,
  placeholder = 'Pick a date',
  className,
  dateOnly = false,
  timeZone,
  localTimeHint = true
}: {
  id?: string
  value: Date | undefined
  onChange: (date: Date | undefined) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  /** Hide the time controls (date-only). */
  dateOnly?: boolean
  /** IANA zone the picked wall-clock is interpreted in. Omit → the device zone. */
  timeZone?: string
  /** Show the picked instant in the viewer's own zone beneath, when it differs. */
  localTimeHint?: boolean
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [timeInput, setTimeInput] = React.useState(value ? timeStringOf(value, timeZone) : '09:00')

  // Reflect an externally-changed value/zone into the time field — React's render-time
  // "adjust state when a prop changes" pattern, not an effect (so the field is right in
  // the same paint). Keyed on the instant + zone, since either changes the shown time.
  const valueKey = `${value ? value.getTime() : 'none'}|${timeZone ?? ''}`
  const [seenKey, setSeenKey] = React.useState(valueKey)
  if (valueKey !== seenKey) {
    setSeenKey(valueKey)
    if (value) setTimeInput(timeStringOf(value, timeZone))
  }

  const commitDate = (date: Date | undefined): void => {
    if (!date) {
      onChange(undefined)
      return
    }
    // react-day-picker hands back a local-midnight Date; its calendar fields are
    // the day the user clicked.
    const y = date.getFullYear()
    const mo = date.getMonth() + 1
    const d = date.getDate()
    if (dateOnly) {
      onChange(new Date(toEpoch(y, mo, d, 0, 0, timeZone)))
      return
    }
    const { h, m } = parseTime(timeInput)
    onChange(new Date(toEpoch(y, mo, d, h, m, timeZone)))
  }

  const commitTime = (raw: string): void => {
    setTimeInput(raw)
    if (!value) return
    const { h, m } = parseTime(raw)
    const p = timeZone
      ? partsInZone(value.getTime(), timeZone)
      : {
          year: value.getFullYear(),
          month: value.getMonth() + 1,
          day: value.getDate()
        }
    onChange(new Date(toEpoch(p.year, p.month, p.day, h, m, timeZone)))
  }

  const displayDay = value ? displayDayOf(value, timeZone) : undefined

  // The month the calendar grid is showing — controlled, so the month/year jump
  // dropdowns can move it directly (rdp's own caption dropdown was not a reliable way
  // to pick a distant year). Reset to the selected day whenever the popover opens.
  const [month, setMonth] = React.useState<Date>(displayDay ?? new Date())
  const jumpMonth = (nextMonthIndex: number, nextYear: number): void => {
    setMonth(new Date(nextYear, nextMonthIndex, 1))
  }

  // The picked instant in the viewer's own zone — only worth showing when the
  // workspace zone differs from their device zone.
  const localTz = detectTimeZone()
  const localHint =
    localTimeHint && value && timeZone && timeZone !== localTz
      ? formatDateLabel(value, dateOnly, localTz)
      : null

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Jump the grid to the selected day (or today) each time it opens.
        if (next) setMonth(displayDay ?? new Date())
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              'h-auto min-h-9 w-full justify-start gap-2 py-1.5 font-normal',
              !value && 'text-muted-foreground',
              className
            )}
          />
        }
      >
        <CalendarBlank className="size-4 shrink-0 text-muted-foreground" weight="duotone" />
        {value ? (
          <span className="flex min-w-0 flex-col items-start leading-tight">
            <span className="truncate">{formatDateLabel(value, dateOnly, timeZone)}</span>
            {localHint ? (
              <span className="truncate text-[11px] font-normal text-muted-foreground">
                Your time: {localHint}
              </span>
            ) : null}
          </span>
        ) : (
          placeholder
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {/* Explicit month + year jump — the reliable way to reach a distant year,
            rather than relying on rdp's caption dropdown. */}
        <div className="flex items-center gap-2 border-b p-2">
          <Select
            items={MONTH_ITEMS}
            value={String(month.getMonth())}
            onValueChange={(value) => jumpMonth(Number(value ?? 0), month.getFullYear())}
          >
            <SelectTrigger className="h-8 flex-1 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, i) => (
                <SelectItem key={name} value={String(i)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            items={YEAR_ITEMS}
            value={String(month.getFullYear())}
            onValueChange={(value) => jumpMonth(month.getMonth(), Number(value ?? CURRENT_YEAR))}
          >
            <SelectTrigger className="h-8 w-[5.5rem] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(YEAR_ITEMS).map((year) => (
                <SelectItem key={year} value={year}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Calendar
          mode="single"
          month={month}
          onMonthChange={setMonth}
          startMonth={new Date(FIRST_YEAR, 0)}
          endMonth={new Date(LAST_YEAR, 11)}
          selected={displayDay}
          onSelect={(date) => {
            commitDate(date ?? undefined)
            if (dateOnly) setOpen(false)
          }}
          autoFocus
        />
        {!dateOnly && (
          <div className="flex items-center gap-2 border-t p-3">
            <Label htmlFor={id ? `${id}-time` : undefined} className="text-xs">
              Time
            </Label>
            <TimeField
              id={id ? `${id}-time` : undefined}
              value={timeInput}
              onChange={commitTime}
              disabled={disabled}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function parseTime(raw: string): { h: number; m: number } {
  const [hStr, mStr] = raw.split(':')
  const h = Math.min(23, Math.max(0, Number.parseInt(hStr, 10) || 0))
  const m = Math.min(59, Math.max(0, Number.parseInt(mStr, 10) || 0))
  return { h, m }
}

/** Calendar-day + time-of-day → epoch, interpreting the wall-clock in `timeZone`
 *  when given, otherwise in the viewer's device zone. */
function toEpoch(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string | undefined
): number {
  if (timeZone) {
    return zonedTimeToUtc({ year: y, month: mo, day: d, hour: h, minute: mi }, timeZone)
  }
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
}

function timeStringOf(value: Date, timeZone: string | undefined): string {
  if (timeZone) {
    const p = partsInZone(value.getTime(), timeZone)
    return `${pad(p.hour)}:${pad(p.minute)}`
  }
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`
}

/** A local Date whose calendar day matches `value`'s day in `timeZone`, so the
 *  react-day-picker calendar highlights the right cell. */
function displayDayOf(value: Date, timeZone: string | undefined): Date {
  if (!timeZone) return value
  const p = partsInZone(value.getTime(), timeZone)
  return new Date(p.year, p.month - 1, p.day)
}

function formatDateLabel(d: Date, dateOnly: boolean, timeZone: string | undefined): string {
  const date = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone
  })
  if (dateOnly) return date
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone
  })
  return `${date} · ${time}`
}
