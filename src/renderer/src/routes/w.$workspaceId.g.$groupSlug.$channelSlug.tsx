import { createFileRoute } from '@tanstack/react-router'
import { ChannelSlugPage } from '@renderer/components/chat/channel-slug-page'

// A GROUPED channel by slug: `/w/<workspace>/g/<group>/<channel>`. The `<group>`
// segment is a readable cosmetic slug of the group name; resolution keys on
// (workspace, channel name), so a channel moving groups just changes this segment.
export const Route = createFileRoute('/w/$workspaceId/g/$groupSlug/$channelSlug')({
  component: GroupedChannel
})

function GroupedChannel(): React.JSX.Element {
  const { workspaceId, channelSlug } = Route.useParams()
  return <ChannelSlugPage workspaceSlug={workspaceId} channelSlug={channelSlug} />
}
