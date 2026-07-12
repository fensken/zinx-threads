import { useMemo } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import {
  WorkspaceDirectoryContext,
  type DirectoryChannel,
  type DirectoryMember,
  type WorkspaceDirectory
} from '@renderer/components/chat/workspace-directory-context'

/** Subscribes once per workspace to the member list + channel list and exposes
 *  them to the whole chat surface. Both queries are already live elsewhere (the
 *  members panel, the sidebar), so Convex dedupes the subscriptions — this adds
 *  a lookup layer, not network traffic. */
export function WorkspaceDirectoryProvider({
  slug,
  workspaceId,
  children
}: {
  slug: string
  workspaceId: Id<'workspaces'>
  children: React.ReactNode
}): React.JSX.Element {
  const rows = useQuery(api.members.listByWorkspace, { workspaceId })
  const channels = useQuery(api.channels.listBySlug, { slug })
  const me = useQuery(api.users.me)

  const value = useMemo<WorkspaceDirectory>(() => {
    const members: DirectoryMember[] = (rows ?? []).map(({ membership, user }) => ({
      userId: user._id,
      name: membership.displayName?.trim() || user.name,
      email: user.email,
      role: membership.role,
      color: user.color ?? FALLBACK_AVATAR_COLOR,
      avatarUrl: user.avatarUrl,
      presence: user.presence,
      statusEmoji: user.statusEmoji,
      statusText: user.statusText,
      joinedAt: membership._creationTime,
      isMe: user._id === me?._id
    }))
    members.sort((a, b) => a.name.localeCompare(b.name))

    const channelList: DirectoryChannel[] = (channels ?? []).map((channel) => ({
      id: channel._id,
      name: channel.name,
      kind: channel.kind
    }))

    const byUser = new Map(members.map((member) => [member.userId, member]))
    const byChannel = new Map(channelList.map((channel) => [channel.id, channel]))

    // Default to *not* a moderator while the list is still loading, so `@everyone`
    // never flashes into the autocomplete for a plain member.
    const mine = members.find((member) => member.isMe)

    return {
      slug,
      canModerate: mine ? mine.role !== 'member' : false,
      members,
      channels: channelList,
      memberById: (userId) => byUser.get(userId),
      channelById: (channelId) => byChannel.get(channelId)
    }
  }, [rows, channels, me?._id, slug])

  return (
    <WorkspaceDirectoryContext.Provider value={value}>
      {children}
    </WorkspaceDirectoryContext.Provider>
  )
}
