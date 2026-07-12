import { createFileRoute } from '@tanstack/react-router'
import { ChannelSlugPage } from '@renderer/components/chat/channel-slug-page'

// An UNGROUPED channel by slug: `/w/<workspace>/<channel>`. (Grouped channels use
// `/w/<workspace>/g/<group>/<channel>`; the `c`/`g`/`t` prefixes are static routes,
// so they win over this dynamic segment — a channel can't be named one of them.)
export const Route = createFileRoute('/w/$workspaceId/$channelSlug')({
  component: UngroupedChannel
})

function UngroupedChannel(): React.JSX.Element {
  const { workspaceId, channelSlug } = Route.useParams()
  return <ChannelSlugPage workspaceSlug={workspaceId} channelSlug={channelSlug} />
}
