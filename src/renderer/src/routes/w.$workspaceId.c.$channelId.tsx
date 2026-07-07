import { createFileRoute } from '@tanstack/react-router'
import { ChannelView } from '@renderer/components/app-shell/channel-view'

export const Route = createFileRoute('/w/$workspaceId/c/$channelId')({
  component: ChannelPage
})

function ChannelPage(): React.JSX.Element {
  const { workspaceId, channelId } = Route.useParams()
  // key remounts the view (resetting local message/thread state) per channel.
  return <ChannelView key={channelId} serverId={workspaceId} channelId={channelId} />
}
