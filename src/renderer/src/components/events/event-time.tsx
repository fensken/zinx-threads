import { Clock } from '@phosphor-icons/react'
import {
  detectTimeZone,
  formatDateInZone,
  formatDateTimeInZone,
  formatTimeInZone,
  sameClock,
  zoneOffsetLabel
} from '@renderer/lib/timezone'
import { cn } from '@renderer/lib/utils'

/**
 * An event's time, in **both** zones that matter.
 *
 * The event was authored in the workspace's zone ("the standup is at 9") — that's
 * the shared, agreed-upon fact, so it leads. Underneath it, the same instant in the
 * reader's own zone, because that's the one they'll actually act on.
 *
 * When the two zones show the same clock, the second line is dropped: repeating your
 * own time back to you is noise, and it makes the genuinely-different case (a
 * teammate five hours away) stop standing out.
 */
export function EventTime({
  startAt,
  endAt,
  allDay,
  timezone,
  withDate = true,
  className
}: {
  startAt: number
  endAt: number
  allDay?: boolean
  /** The zone the event was authored in (the workspace's). */
  timezone: string
  withDate?: boolean
  className?: string
}): React.JSX.Element {
  const viewer = detectTimeZone()
  const differs = !sameClock(timezone, viewer, startAt)

  // An all-day event names a DATE, not an instant — so it must be rendered in the
  // zone it was authored in, or it slides a day for anyone far enough east or west.
  // There is no "your local time" for it, because there is no clock.
  if (allDay) {
    const start = formatDateInZone(startAt, timezone)
    const end = formatDateInZone(endAt, timezone)
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        {start === end ? `${start} · All day` : `${start} → ${end} · All day`}
      </span>
    )
  }

  const sameDay = formatDateInZone(startAt, timezone) === formatDateInZone(endAt, timezone)
  const primary = withDate
    ? `${formatDateTimeInZone(startAt, timezone)} – ${
        sameDay ? formatTimeInZone(endAt, timezone) : formatDateTimeInZone(endAt, timezone)
      }`
    : `${formatTimeInZone(startAt, timezone)} – ${formatTimeInZone(endAt, timezone)}`

  return (
    <span className={cn('flex flex-col gap-0.5 text-xs', className)}>
      <span className="text-foreground">{primary}</span>
      {differs ? (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3 shrink-0" />
          {formatTimeInZone(startAt, viewer)} – {formatTimeInZone(endAt, viewer)} your time (
          {zoneOffsetLabel(viewer, startAt)})
        </span>
      ) : null}
    </span>
  )
}
