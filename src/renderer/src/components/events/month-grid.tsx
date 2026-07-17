import { useMemo } from 'react'
import { ArrowsClockwise } from '@phosphor-icons/react'
import type { CalendarEvent, GridDay } from '@renderer/lib/calendar-grid'
import { KIND_META } from '@renderer/components/events/event-kind'
import { formatTimeInZone } from '@renderer/lib/timezone'
import { cn } from '@renderer/lib/utils'

/** How many chips fit in a day cell before it says "+N more". */
const MAX_CHIPS = 3

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The month grid. Presentational: `buildMonthGrid` (in `lib/calendar-grid.ts`) does
 *  the zone-aware date maths; this only draws it. */
export function MonthGrid({
  days,
  events,
  zone,
  onPickDay,
  onOpenEvent
}: {
  days: GridDay[]
  events: CalendarEvent[]
  /** The workspace's zone — the grid's days and the chips' times are both in it. */
  zone: string
  onPickDay: (day: GridDay) => void
  onOpenEvent: (event: CalendarEvent) => void
}): React.JSX.Element {
  // An event lands in every day it overlaps, so a two-day offsite shows on both.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const day of days) {
      const hits = events.filter((event) => event.startAt < day.endAt && event.endAt >= day.startAt)
      if (hits.length) map.set(day.key, hits)
    }
    return map
  }, [days, events])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b">
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            className="px-2 py-1.5 text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {label}
          </div>
        ))}
      </div>

      {/* `auto-rows-fr` + `min-h-0`: six equal rows that fill the space, so the grid
          never scrolls its own height and cells stay the same size all year. */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7">
        {days.map((day) => {
          const hits = byDay.get(day.key) ?? []
          return (
            <button
              key={day.key}
              type="button"
              onClick={() => onPickDay(day)}
              className={cn(
                'group flex min-h-0 flex-col gap-0.5 overflow-hidden border-r border-b p-1 text-left transition-colors last:border-r-0 hover:bg-accent/40',
                !day.inMonth && 'bg-muted/30 text-muted-foreground'
              )}
            >
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
                  day.isToday && 'bg-primary font-bold text-primary-foreground',
                  !day.isToday && !day.inMonth && 'text-muted-foreground'
                )}
              >
                {day.day}
              </span>

              <span className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                {hits.slice(0, MAX_CHIPS).map((event) => (
                  <span
                    key={event.instanceKey}
                    // A chip inside the day button: a nested <button> is invalid HTML,
                    // so this is a span that stops the click from also picking the day.
                    role="button"
                    tabIndex={0}
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation()
                      onOpenEvent(event)
                    }}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                        keyEvent.stopPropagation()
                        keyEvent.preventDefault()
                        onOpenEvent(event)
                      }
                    }}
                    // A coloured kind dot carries the type; the chip itself stays neutral
                    // so a busy day isn't a rainbow.
                    className="flex items-center gap-1 truncate rounded bg-muted px-1 py-0.5 text-[10px] text-foreground transition-colors hover:bg-accent"
                  >
                    <span
                      className={cn('size-1.5 shrink-0 rounded-full', KIND_META[event.kind].dot)}
                    />
                    {!event.allDay ? (
                      <span className="shrink-0 font-medium text-muted-foreground">
                        {formatTimeInZone(event.startAt, zone)}
                      </span>
                    ) : null}
                    <span className="truncate">{event.title}</span>
                    {event.isRecurring ? (
                      <ArrowsClockwise className="ml-auto size-2.5 shrink-0 text-muted-foreground" />
                    ) : null}
                  </span>
                ))}
                {hits.length > MAX_CHIPS ? (
                  <span className="px-1 text-[10px] text-muted-foreground">
                    +{hits.length - MAX_CHIPS} more
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
