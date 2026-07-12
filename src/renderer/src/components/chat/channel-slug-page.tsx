import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import { Spinner } from '@renderer/components/ui/spinner'
import { RealChannelPage } from '@renderer/components/chat/real-channel-page'

/** Resolves a slug URL (`/w/<ws>/<channelSlug>` or `/w/<ws>/g/<group>/<channelSlug>`)
 *  to a channel, then renders it. The channel slug is its (workspace-unique) name;
 *  the group segment is cosmetic and not consulted. Resolves an owned channel from the
 *  already-subscribed `listBySlug` cache, falling back to `resolveBySlug` for a channel
 *  shared INTO this workspace (a guest opening it by slug). Not keyed — `RealChannelPage`
 *  keys the message view itself. */
export function ChannelSlugPage({
  workspaceSlug,
  channelSlug
}: {
  workspaceSlug: string
  channelSlug: string
}): React.JSX.Element {
  const channels = useQuery(api.channels.listBySlug, { slug: workspaceSlug })
  const owned = channels?.find((channel) => channel.name === channelSlug) ?? null
  const resolved = useQuery(
    api.channels.resolveBySlug,
    channels !== undefined && !owned ? { workspaceSlug, channelSlug } : 'skip'
  )
  const channel = owned ?? resolved ?? null

  if (channels === undefined || (!owned && resolved === undefined)) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }
  if (!channel) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-muted-foreground">
        Channel not found.
      </div>
    )
  }
  return <RealChannelPage serverId={workspaceSlug} channelId={channel._id} />
}
