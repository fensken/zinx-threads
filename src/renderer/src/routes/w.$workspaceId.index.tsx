import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import { ChannelViewSkeleton } from '@renderer/components/common/skeletons'
import { toSlug } from '@renderer/lib/slug'

export const Route = createFileRoute('/w/$workspaceId/')({
  component: WorkspaceHome
})

/** Where `/w/<slug>` lands. The workspace's home channel (`isDefault`) exists for
 *  exactly this; fall back to the first channel **as the sidebar orders it** —
 *  ungrouped channels render above the groups, so "first" is the first ungrouped
 *  one, not simply the lowest `order`. */
function landingChannel<T extends { groupId?: string; isDefault?: boolean }>(
  channels: T[]
): T | undefined {
  return channels.find((c) => c.isDefault) ?? channels.find((c) => !c.groupId) ?? channels[0]
}

function WorkspaceHome(): React.JSX.Element {
  const { workspaceId } = Route.useParams()
  const channels = useQuery(api.channels.listBySlug, { slug: workspaceId })
  const groups = useQuery(api.groups.listBySlug, { slug: workspaceId })

  if (channels === undefined) {
    return <ChannelViewSkeleton />
  }
  const target = landingChannel(channels)
  if (!target) return <EmptyState />

  // A grouped landing target needs the group name to build the canonical URL.
  if (target.groupId && groups === undefined) {
    return <ChannelViewSkeleton />
  }
  const group = target.groupId ? groups?.find((g) => g._id === target.groupId) : undefined
  return group ? (
    <Navigate
      to="/w/$workspaceId/g/$groupSlug/$channelSlug"
      params={{ workspaceId, groupSlug: toSlug(group.name), channelSlug: target.name }}
      replace
    />
  ) : (
    <Navigate
      to="/w/$workspaceId/$channelSlug"
      params={{ workspaceId, channelSlug: target.name }}
      replace
    />
  )
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
      <p className="text-lg font-semibold text-foreground">No channels yet</p>
      <p className="max-w-sm text-sm">
        Create a channel from the sidebar to start the conversation.
      </p>
    </div>
  )
}
