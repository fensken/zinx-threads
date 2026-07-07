import { cn } from '@renderer/lib/utils'
import { getMembers, getRole, type Member } from '@renderer/data/workspaces'
import { Avatar } from './avatar'

const HOISTED_ROLES = ['bot', 'admin', 'mod']

interface Group {
  key: string
  label: string
  members: Member[]
}

function buildGroups(members: Member[]): Group[] {
  const online = members.filter((m) => m.presence !== 'offline')
  const offline = members.filter((m) => m.presence === 'offline')
  const used = new Set<string>()
  const groups: Group[] = []

  for (const roleId of HOISTED_ROLES) {
    const inRole = online.filter((m) => m.roleId === roleId)
    if (inRole.length) {
      inRole.forEach((m) => used.add(m.id))
      groups.push({ key: roleId, label: getRole(roleId)?.name ?? roleId, members: inRole })
    }
  }
  const others = online.filter((m) => !used.has(m.id))
  if (others.length) groups.push({ key: 'online', label: 'Online', members: others })
  if (offline.length) groups.push({ key: 'offline', label: 'Offline', members: offline })
  return groups
}

export function MemberList({ serverId }: { serverId: string }): React.JSX.Element {
  const groups = buildGroups(getMembers(serverId))

  return (
    <aside className="h-full w-full overflow-y-auto py-4">
      {groups.map((group) => (
        <div key={group.key} className="mb-5 px-2">
          <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {group.label} — {group.members.length}
          </div>
          {group.members.map((member) => (
            <MemberRow key={member.id} member={member} />
          ))}
        </div>
      ))}
    </aside>
  )
}

function MemberRow({ member }: { member: Member }): React.JSX.Element {
  const role = getRole(member.roleId)
  const offline = member.presence === 'offline'
  const nameColor = role?.color && !offline ? { color: role.color } : undefined

  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-sidebar-accent"
    >
      <Avatar
        initials={member.initials}
        color={member.color}
        presence={member.presence}
        ringClassName="ring-2 ring-sidebar"
        className={cn('size-8', offline && 'opacity-70')}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span
            className={cn('truncate text-sm font-medium', offline && 'text-muted-foreground')}
            style={nameColor}
          >
            {member.name}
          </span>
          {member.bot ? (
            <span className="rounded bg-primary px-1 text-[9px] font-bold text-primary-foreground uppercase">
              App
            </span>
          ) : null}
        </div>
        {member.status ? (
          <div className="truncate text-xs text-muted-foreground">{member.status}</div>
        ) : null}
      </div>
    </button>
  )
}
