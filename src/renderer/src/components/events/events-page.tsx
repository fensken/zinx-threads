import { useMemo, useState } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { CalendarDots, CaretLeft, CaretRight, List, Plus } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { IconButton } from '@renderer/components/common/icon-button'
import { SidebarToggle } from '@renderer/components/layout/sidebar-toggle'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { CalendarSkeleton } from '@renderer/components/common/skeletons'
import { Button } from '@renderer/components/ui/button'
import { EventDetailDialog } from '@renderer/components/events/event-detail-dialog'
import { EventDialog } from '@renderer/components/events/event-dialog'
import { EventTime } from '@renderer/components/events/event-time'
import { MonthGrid } from '@renderer/components/events/month-grid'
import { buildMonthGrid, type CalendarEvent } from '@renderer/lib/calendar-grid'
import { partsInZone, safeZone, zoneLabel } from '@renderer/lib/timezone'
import { useNow } from '@renderer/lib/use-now'
import { useUiStore } from '@renderer/store/ui-store'
import { cn } from '@renderer/lib/utils'

const MONTHS = [
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

/** The workspace calendar.
 *
 *  **Everything is laid out in the workspace's zone**, not the viewer's — which day
 *  an event falls on is a question only the team's clock can answer, and a calendar
 *  that silently re-buckets events into the reader's zone would put the Monday
 *  standup on Sunday for anyone far enough west. Each event still shows the viewer's
 *  own time underneath (see `EventTime`); the *grid* is the team's.
 *
 *  Two views: **Month** (the grid) and **Upcoming** (a list, for when you just want
 *  to know what's next). */
export function EventsPage({ serverId }: { serverId: string }): React.JSX.Element {
  const resolved = useQuery(api.workspaces.getBySlug, { slug: serverId })
  const workspace = resolved?.workspace
  const zone = safeZone(workspace?.timezone)
  const now = useNow().getTime()

  const [view, setView] = useState<'month' | 'upcoming'>('month')
  // Seeded lazily, and only once the workspace's zone is known. On the first render
  // `resolved` is still `undefined`, so `zone` is the *viewer's* — and a `useState`
  // initialiser runs exactly once, so near a month boundary (viewer and workspace on
  // opposite sides of it) the calendar would open on the wrong month and stay there.
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null)
  const month = cursor ?? partsInZone(now, zone)
  const [creating, setCreating] = useState<{ seedAt?: number } | null>(null)
  const [editing, setEditing] = useState<CalendarEvent | null>(null)
  const [detailId, setDetailId] = useState<CalendarEvent['_id'] | null>(null)
  const setNavOpen = useUiStore((s) => s.setNavOpen)

  const days = useMemo(
    () => buildMonthGrid(month.year, month.month, zone, now),
    [month.year, month.month, zone, now]
  )
  // The grid's own bounds — so the query fetches exactly what's drawn, including the
  // leading/trailing days of the neighbouring months.
  const from = days[0]?.startAt ?? 0
  const to = days[days.length - 1]?.endAt ?? 0

  const monthEvents = useQuery(
    api.events.listRange,
    workspace && view === 'month' ? { workspaceId: workspace._id, from, to } : 'skip'
  )
  const upcoming = useQuery(
    api.events.listUpcoming,
    workspace && view === 'upcoming' ? { workspaceId: workspace._id, limit: 20 } : 'skip'
  )

  const step = (delta: number): void => {
    const next = month.month + delta
    if (next < 1) setCursor({ year: month.year - 1, month: 12 })
    else if (next > 12) setCursor({ year: month.year + 1, month: 1 })
    else setCursor({ year: month.year, month: next })
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <IconButton label="Open navigation" className="md:hidden" onClick={() => setNavOpen(true)}>
          <List className="size-5" />
        </IconButton>
        <SidebarToggle />
        <CalendarDots className="size-5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold">Events</span>
        {/* Say whose clock this is. Without it, a calendar is an invitation to
            mis-read every time on it. */}
        <span className="hidden truncate text-sm text-muted-foreground xl:block">
          · {zoneLabel(zone)}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ViewTab label="Month" active={view === 'month'} onClick={() => setView('month')} />
          <ViewTab
            label="Upcoming"
            active={view === 'upcoming'}
            onClick={() => setView('upcoming')}
          />
          <Button size="sm" className="ml-1" onClick={() => setCreating({})}>
            <Plus className="size-4" weight="bold" />
            New event
          </Button>
        </div>
      </header>

      {view === 'month' ? (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2">
            <IconButton label="Previous month" onClick={() => step(-1)}>
              <CaretLeft className="size-4" />
            </IconButton>
            <IconButton label="Next month" onClick={() => step(1)}>
              <CaretRight className="size-4" />
            </IconButton>
            <span className="ml-1 text-sm font-semibold">
              {MONTHS[month.month - 1]} {month.year}
            </span>
            <button
              type="button"
              onClick={() => setCursor(partsInZone(Date.now(), zone))}
              className="ml-2 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Today
            </button>
          </div>

          {monthEvents === undefined ? (
            <CalendarSkeleton />
          ) : (
            <MonthGrid
              days={days}
              events={monthEvents}
              zone={zone}
              onPickDay={(day) => setCreating({ seedAt: day.startAt })}
              onOpenEvent={(event) => setDetailId(event._id)}
            />
          )}
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-2 p-4">
            {upcoming === undefined ? (
              <LoadingBlock />
            ) : upcoming.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
                <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <CalendarDots className="size-5" />
                </span>
                <p className="text-sm font-medium">Nothing coming up</p>
                <p className="max-w-72 text-xs text-muted-foreground">
                  Schedule a standup, a review, or a call — everyone sees it in their own time zone.
                </p>
              </div>
            ) : (
              upcoming.map((event) => (
                <button
                  key={event._id}
                  type="button"
                  onClick={() => setDetailId(event._id)}
                  className="flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {event.title}
                    </span>
                    {event.myStatus === 'going' ? (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Going
                      </span>
                    ) : null}
                  </span>
                  <EventTime
                    startAt={event.startAt}
                    endAt={event.endAt}
                    allDay={event.allDay}
                    timezone={event.timezone}
                  />
                  <span className="text-xs text-muted-foreground">
                    {event.channelName ? `#${event.channelName} · ` : ''}
                    {event.going} going
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {workspace && creating ? (
        <EventDialog
          // Keyed: the form seeds its fields once, at mount.
          key={`new-${creating.seedAt ?? 'now'}`}
          workspaceId={workspace._id}
          workspaceSlug={serverId}
          zone={zone}
          seedAt={creating.seedAt}
          open
          onOpenChange={(next) => !next && setCreating(null)}
        />
      ) : null}

      {workspace && editing ? (
        <EventDialog
          key={editing._id}
          workspaceId={workspace._id}
          workspaceSlug={serverId}
          zone={zone}
          event={editing}
          open
          onOpenChange={(next) => !next && setEditing(null)}
        />
      ) : null}

      <EventDetailDialog
        eventId={detailId}
        open={detailId !== null}
        onOpenChange={(next) => !next && setDetailId(null)}
        onEdit={() => {
          const found =
            (monthEvents ?? []).find((event) => event._id === detailId) ??
            (upcoming ?? []).find((event) => event._id === detailId) ??
            null
          setDetailId(null)
          setEditing(found)
        }}
      />
    </div>
  )
}

function ViewTab({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-accent font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}
