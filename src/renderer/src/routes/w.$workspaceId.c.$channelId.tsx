import { createFileRoute } from '@tanstack/react-router'
import { RealChannelPage } from '@renderer/components/chat/real-channel-page'

// Permalink to a channel by its **id** (`/w/<workspace>/c/<channelId>`). The sidebar
// and links build the readable slug URLs, but this stable by-id form stays for
// deep links + as the reliable target for a shared channel a guest reaches.
export const Route = createFileRoute('/w/$workspaceId/c/$channelId')({
  component: ChannelPage
})

function ChannelPage(): React.JSX.Element {
  const { workspaceId, channelId } = Route.useParams()
  return <RealChannelPage serverId={workspaceId} channelId={channelId} />
}
