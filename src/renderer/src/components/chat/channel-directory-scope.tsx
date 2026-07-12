import { useMemo } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import {
  WorkspaceDirectoryContext,
  useWorkspaceDirectory,
  type DirectoryMember,
  type MemberRole
} from '@renderer/components/chat/workspace-directory-context'

/** For a **shared** (cross-workspace) channel, augment the workspace directory with
 *  the members of every OTHER workspace that has access — so `@`-mentions, mention
 *  pills and author profile cards resolve people who aren't in your own workspace.
 *  You can ping anyone who can see the channel, regardless of workspace.
 *
 *  A no-op for a normal channel (the members query is skipped unless the channel is
 *  actually shared) and a passthrough in mock builds (no base directory to augment). */
export function ChannelDirectoryScope({
  channelId,
  children
}: {
  channelId: Id<'channels'>
  children: React.ReactNode
}): React.JSX.Element {
  const base = useWorkspaceDirectory()
  // `connection` is already subscribed by the header pill, so this is deduped.
  const connection = useQuery(api.sharedChannels.connection, { channelId })
  const extra = useQuery(
    api.members.listChannelMembers,
    connection?.isShared ? { channelId } : 'skip'
  )

  const value = useMemo(() => {
    if (!base) return null
    if (!extra || extra.length === 0) return base
    const byUser = new Map(base.members.map((member) => [member.userId, member]))
    for (const row of extra) {
      // Your own workspace's copy of a person wins (it carries `isMe` + your role).
      if (byUser.has(row.userId)) continue
      const member: DirectoryMember = {
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: row.role as MemberRole,
        color: row.color ?? FALLBACK_AVATAR_COLOR,
        avatarUrl: row.avatarUrl,
        presence: row.presence,
        statusEmoji: row.statusEmoji,
        statusText: row.statusText,
        joinedAt: row.joinedAt,
        isMe: false
      }
      byUser.set(row.userId, member)
    }
    const members = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name))
    const memberIndex = new Map(members.map((member) => [member.userId, member]))
    return { ...base, members, memberById: (id: string) => memberIndex.get(id) }
  }, [base, extra])

  if (!base) return <>{children}</>
  return (
    <WorkspaceDirectoryContext.Provider value={value ?? base}>
      {children}
    </WorkspaceDirectoryContext.Provider>
  )
}
