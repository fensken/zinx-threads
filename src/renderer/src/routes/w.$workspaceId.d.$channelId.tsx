import { createFileRoute } from '@tanstack/react-router'
import { DmPage } from '@renderer/components/chat/dm-page'

// A direct message (`/w/<workspace>/d/<channelId>`). By **id**, not a slug: a DM has
// no name — it's the people in it, and their names are neither unique nor stable
// (they can be renamed, and a group's title is derived from everyone in it).
export const Route = createFileRoute('/w/$workspaceId/d/$channelId')({
  component: DirectMessagePage
})

function DirectMessagePage(): React.JSX.Element {
  const { workspaceId, channelId } = Route.useParams()
  return <DmPage serverId={workspaceId} channelId={channelId} />
}
