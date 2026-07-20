import { DateTimePicker } from '@renderer/components/common/date-time-picker'

/**
 * A date-only field over the app's ONE date picker (`DateTimePicker`, the same one Events
 * use), for surfaces that store a plain `YYYY-MM-DD` string (form date fields, database date
 * cells). Wraps the Date-based picker with string↔Date conversion so date-picking looks and
 * behaves identically everywhere — no more native `<input type="date">`.
 */
export function DateField({
  value,
  onChange,
  id,
  className,
  disabled,
  placeholder
}: {
  value: string | null | undefined
  onChange: (value: string | null) => void
  id?: string
  className?: string
  disabled?: boolean
  placeholder?: string
}): React.JSX.Element {
  return (
    <DateTimePicker
      id={id}
      value={ymdToDate(value)}
      dateOnly
      localTimeHint={false}
      className={className}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(date) => onChange(date ? dateToYmd(date) : null)}
    />
  )
}

/** `YYYY-MM-DD` → a local-midnight Date (matching how `DateTimePicker` reads dateOnly). */
function ymdToDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** A local Date → `YYYY-MM-DD`. */
function dateToYmd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
