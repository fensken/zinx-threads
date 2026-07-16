import { createFileRoute } from '@tanstack/react-router'
import { EventsPage } from '@renderer/components/events/events-page'

// The workspace calendar. Unlike the Inbox (which is the user's and spans every
// workspace), events belong to ONE workspace — they're scheduled in its time zone and
// its members are the audience.
export const Route = createFileRoute('/w/$workspaceId/events')({
  component: EventsRoute
})

function EventsRoute(): React.JSX.Element {
  const { workspaceId } = Route.useParams()
  return <EventsPage serverId={workspaceId} />
}
