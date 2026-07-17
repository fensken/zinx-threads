import { useMemo, useState } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import {
  CalendarDots,
  CaretDown,
  CaretLeft,
  CaretRight,
  Funnel,
  List,
  Plus
} from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { IconButton } from '@renderer/components/common/icon-button'
import { SidebarToggle } from '@renderer/components/layout/sidebar-toggle'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { CalendarSkeleton } from '@renderer/components/common/skeletons'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { EventDetailDialog } from '@renderer/components/events/event-detail-dialog'
import { EventDialog } from '@renderer/components/events/event-dialog'
import { EventTime } from '@renderer/components/events/event-time'
import { EVENT_KINDS, KIND_META, type EventKind } from '@renderer/components/events/event-kind'
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
  // Client-side filters (type + your RSVP) over the loaded events — no extra query.
  const [kindFilter, setKindFilter] = useState<'all' | EventKind>('all')
  const [rsvpFilter, setRsvpFilter] = useState<'all' | 'going' | 'maybe'>('all')
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

  const filtersActive = kindFilter !== 'all' || rsvpFilter !== 'all'
  const matches = (e: { kind: EventKind; myStatus?: string | null }): boolean => {
    if (kindFilter !== 'all' && e.kind !== kindFilter) return false
    if (rsvpFilter !== 'all' && e.myStatus !== rsvpFilter) return false
    return true
  }

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
          <EventFilters
            kindFilter={kindFilter}
            onKindFilter={setKindFilter}
            rsvpFilter={rsvpFilter}
            onRsvpFilter={setRsvpFilter}
            active={filtersActive}
            onClear={() => {
              setKindFilter('all')
              setRsvpFilter('all')
            }}
          />
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
            <MonthYearPicker
              year={month.year}
              month={month.month}
              onPick={(year, m) => setCursor({ year, month: m })}
            />
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
              events={monthEvents.filter(matches)}
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
            ) : upcoming.filter(matches).length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
                <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {filtersActive ? (
                    <Funnel className="size-5" />
                  ) : (
                    <CalendarDots className="size-5" />
                  )}
                </span>
                <p className="text-sm font-medium">
                  {filtersActive ? 'No matching events' : 'Nothing coming up'}
                </p>
                <p className="max-w-72 text-xs text-muted-foreground">
                  {filtersActive
                    ? 'No upcoming events match your filters. Try clearing them.'
                    : 'Schedule a standup, a review, or a call — everyone sees it in their own time zone.'}
                </p>
              </div>
            ) : (
              upcoming.filter(matches).map((event) => (
                <button
                  key={event.instanceKey}
                  type="button"
                  onClick={() => setDetailId(event._id)}
                  className="flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn('size-2 shrink-0 rounded-full', KIND_META[event.kind].dot)}
                    />
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
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {event.channelName ? (
                      <>
                        <ChannelKindIcon
                          kind={event.channelKind ?? 'voice'}
                          className="size-3 shrink-0"
                        />
                        <span className="truncate">{event.channelName}</span>
                        <span>·</span>
                      </>
                    ) : null}
                    {event.going} going{event.repeat !== 'none' ? ' · repeats' : ''}
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
        workspaceSlug={serverId}
        open={detailId !== null}
        onOpenChange={(next) => !next && setDetailId(null)}
        onEdit={(event) => {
          // Edit the SERIES, not the clicked occurrence — `event` comes from
          // `events.get` (un-expanded), so its `startAt` is the series origin. Re-finding
          // an expanded occurrence here would re-anchor the whole series to that date.
          setDetailId(null)
          setEditing(event)
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

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

/** The `Month Year` label, but a button that opens a jump-to-any-month picker —
 *  a year stepper over a 3×4 grid of months, so you're never more than two
 *  clicks from any month without spamming the arrows. */
function MonthYearPicker({
  year,
  month,
  onPick
}: {
  year: number
  month: number
  onPick: (year: number, month: number) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // The year the grid is showing — seeded from the current cursor, steppable
  // without committing until you pick a month.
  const [viewYear, setViewYear] = useState(year)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setViewYear(year)
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="ml-1 flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold transition-colors hover:bg-accent"
          >
            {MONTHS[month - 1]} {year}
            <CaretDown className="size-3 text-muted-foreground" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-56 p-2">
        <div className="mb-2 flex items-center justify-between">
          <IconButton label="Previous year" onClick={() => setViewYear((y) => y - 1)}>
            <CaretLeft className="size-4" />
          </IconButton>
          <span className="text-sm font-semibold">{viewYear}</span>
          <IconButton label="Next year" onClick={() => setViewYear((y) => y + 1)}>
            <CaretRight className="size-4" />
          </IconButton>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {SHORT_MONTHS.map((label, i) => {
            const active = viewYear === year && i + 1 === month
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  onPick(viewYear, i + 1)
                  setOpen(false)
                }}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Filter the calendar by event **type** and by your own **RSVP** — both applied
 *  client-side over the already-loaded events, so opening the filter costs no
 *  round-trip. A dot on the funnel marks that filters are active. */
function EventFilters({
  kindFilter,
  onKindFilter,
  rsvpFilter,
  onRsvpFilter,
  active,
  onClear
}: {
  kindFilter: 'all' | EventKind
  onKindFilter: (value: 'all' | EventKind) => void
  rsvpFilter: 'all' | 'going' | 'maybe'
  onRsvpFilter: (value: 'all' | 'going' | 'maybe') => void
  active: boolean
  onClear: () => void
}): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Filter events"
            className={cn(
              'relative flex size-8 items-center justify-center rounded-md transition-colors hover:bg-accent',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Funnel className="size-4" weight={active ? 'fill' : 'regular'} />
            {active ? (
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
            ) : null}
          </button>
        }
      />
      <PopoverContent align="end" className="w-64 p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">Filters</span>
          {active ? (
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </div>

        <FilterGroup label="Type">
          <FilterChip
            label="Any"
            active={kindFilter === 'all'}
            onClick={() => onKindFilter('all')}
          />
          {EVENT_KINDS.map((k) => (
            <FilterChip
              key={k}
              label={KIND_META[k].label}
              dot={KIND_META[k].dot}
              active={kindFilter === k}
              onClick={() => onKindFilter(k)}
            />
          ))}
        </FilterGroup>

        <FilterGroup label="RSVP">
          <FilterChip
            label="Any"
            active={rsvpFilter === 'all'}
            onClick={() => onRsvpFilter('all')}
          />
          <FilterChip
            label="Going"
            active={rsvpFilter === 'going'}
            onClick={() => onRsvpFilter('going')}
          />
          <FilterChip
            label="Maybe"
            active={rsvpFilter === 'maybe'}
            onClick={() => onRsvpFilter('maybe')}
          />
        </FilterGroup>
      </PopoverContent>
    </Popover>
  )
}

function FilterGroup({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
  dot
}: {
  label: string
  active: boolean
  onClick: () => void
  /** Optional coloured dot (the event-kind marker). */
  dot?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      {dot ? <span className={cn('size-2 shrink-0 rounded-full', dot)} /> : null}
      {label}
    </button>
  )
}
