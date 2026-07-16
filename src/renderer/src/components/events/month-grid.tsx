import { useMemo } from 'react'
import type { CalendarEvent, GridDay } from '@renderer/lib/calendar-grid'
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
                    key={event._id}
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
                    className="flex items-center gap-1 truncate rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary transition-colors hover:bg-primary/20"
                  >
                    {!event.allDay ? (
                      <span className="shrink-0 font-medium opacity-80">
                        {formatTimeInZone(event.startAt, zone)}
                      </span>
                    ) : null}
                    <span className="truncate">{event.title}</span>
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
