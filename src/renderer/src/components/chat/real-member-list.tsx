import { useQuery } from 'convex-helpers/react/cache/hooks'
import type { FunctionReturnType } from 'convex/server'
import { Users, X } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar } from '@renderer/components/common/avatar'
import { IconButton } from '@renderer/components/common/icon-button'
import { Spinner } from '@renderer/components/ui/spinner'
import { presenceWithConnectivity } from '@renderer/lib/user-status'
import { useIsOnline } from '@renderer/store/presence-store'
import { useUiStore } from '@renderer/store/ui-store'

type Member = FunctionReturnType<typeof api.members.listByWorkspace>[number]

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Owner + admins are hoisted above members (Discord-style), each in its own group.
const ROLE_ORDER = ['owner', 'admin', 'member'] as const
const ROLE_LABEL: Record<(typeof ROLE_ORDER)[number], string> = {
  owner: 'Owner',
  admin: 'Admins',
  member: 'Members'
}

/** Convex-backed member list (real workspaces): a header (matching the thread
 *  panel's) + the members grouped by role. Mirrors the demo `MemberList` visual. */
export function RealMemberList({
  workspaceId
}: {
  workspaceId: Id<'workspaces'>
}): React.JSX.Element {
  const members = useQuery(api.members.listByWorkspace, { workspaceId })
  const setMemberListOpen = useUiStore((state) => state.setMemberListOpen)

  const groups = ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABEL[role],
    members: (members ?? []).filter((m) => m.membership.role === role)
  })).filter((group) => group.members.length > 0)

  return (
    <aside className="flex h-full w-full flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 shadow-sm">
        <Users className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold">Members</span>
          {members !== undefined ? (
            <span className="truncate text-xs text-muted-foreground">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </span>
          ) : null}
        </div>
        <div className="ml-auto shrink-0">
          <IconButton label="Close members" onClick={() => setMemberListOpen(false)}>
            <X className="size-5" />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        {members === undefined ? (
          <div className="flex h-full w-full items-center justify-center">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.role} className="mb-5 px-2">
              <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group.label} — {group.members.length}
              </div>
              {group.members.map((member) => (
                <MemberRow key={member.membership._id} member={member} />
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

function MemberRow({ member }: { member: Member }): React.JSX.Element {
  const name = member.membership.displayName?.trim() || member.user.name
  const custom = member.user.statusText
    ? `${member.user.statusEmoji ? `${member.user.statusEmoji} ` : ''}${member.user.statusText}`
    : null
  // Offline (grey) when their app isn't connected, else their chosen status.
  const isOnline = useIsOnline(member.user._id)
  return (
    <div className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-sidebar-accent">
      <Avatar
        initials={initialsOf(name)}
        color={member.user.color ?? '#5865f2'}
        image={member.user.avatarUrl}
        presence={presenceWithConnectivity(member.user.presence, isOnline)}
        ringClassName="ring-2 ring-sidebar"
        className="size-8"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="truncate text-xs text-muted-foreground">{custom ?? member.user.email}</div>
      </div>
    </div>
  )
}
