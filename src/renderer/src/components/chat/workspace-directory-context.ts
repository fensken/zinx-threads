import { createContext, useContext } from 'react'

export type MemberRole = 'owner' | 'admin' | 'member'

/** One workspace member, flattened from `members.listByWorkspace`. */
export interface DirectoryMember {
  userId: string
  /** Effective name: the per-workspace nickname if set, else the account name. */
  name: string
  email: string
  role: MemberRole
  color: string
  avatarUrl?: string | null
  presence?: string | null
  statusEmoji?: string | null
  statusText?: string | null
  /** `workspaceMembers._creationTime` — when they joined this workspace. */
  joinedAt: number
  isMe: boolean
}

export interface DirectoryChannel {
  id: string
  name: string
  kind: 'chat' | 'voice' | 'page' | 'kanban'
}

/** Everything the chat surface needs to turn ids back into people and channels:
 *  the `@`/`#` autocompletes, the mention pills, and the author profile card all
 *  read from here rather than each firing their own query. */
export interface WorkspaceDirectory {
  slug: string
  /** The signed-in user is an owner/admin — may insert `@everyone`. */
  canModerate: boolean
  members: DirectoryMember[]
  channels: DirectoryChannel[]
  memberById: (userId: string) => DirectoryMember | undefined
  channelById: (channelId: string) => DirectoryChannel | undefined
}

export const WorkspaceDirectoryContext = createContext<WorkspaceDirectory | null>(null)

/** `null` outside a provider (mock builds) — callers fall back to the label that
 *  was embedded in the message. */
export function useWorkspaceDirectory(): WorkspaceDirectory | null {
  return useContext(WorkspaceDirectoryContext)
}
