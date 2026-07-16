import { useNavigate } from '@tanstack/react-router'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { ArrowRight, CalendarDots } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { NavEmptyState } from '@renderer/components/chat/nav-flyout'
import { EventTime } from '@renderer/components/events/event-time'

/** The header's Events flyout — **what's coming up**, and a way through to the
 *  calendar. The mirror of the Inbox peek: the sidebar navigates to the page, the
 *  header gives you the glance without leaving the channel you're in. */
export function UpcomingEventsList({
  workspaceId,
  workspaceSlug,
  onNavigate
}: {
  workspaceId: Id<'workspaces'>
  workspaceSlug: string
  onNavigate: () => void
}): React.JSX.Element {
  const events = useQuery(api.events.listUpcoming, { workspaceId, limit: 6 })
  const navigate = useNavigate()

  if (events === undefined) return <LoadingBlock />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {events.length === 0 ? (
        <NavEmptyState
          icon={<CalendarDots className="size-5" />}
          title="Nothing coming up"
          message="Schedule a standup, a review or a call — everyone sees it in their own time zone."
        />
      ) : (
        <div className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {events.map((event) => (
            <button
              key={event._id}
              type="button"
              onClick={() => {
                void navigate({
                  to: '/w/$workspaceId/events',
                  params: { workspaceId: workspaceSlug }
                })
                onNavigate()
              }}
              className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
            >
              <span className="truncate text-sm font-medium">{event.title}</span>
              <EventTime
                startAt={event.startAt}
                endAt={event.endAt}
                allDay={event.allDay}
                timezone={event.timezone}
              />
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          void navigate({ to: '/w/$workspaceId/events', params: { workspaceId: workspaceSlug } })
          onNavigate()
        }}
        className="mt-1 flex shrink-0 items-center justify-center gap-1.5 border-t px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Open calendar
        <ArrowRight className="size-3.5" weight="bold" />
      </button>
    </div>
  )
}
