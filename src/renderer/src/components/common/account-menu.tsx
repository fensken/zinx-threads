import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { CaretDown } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { useAppAuth } from '@renderer/lib/use-app-auth'
import { useUiStore } from '@renderer/store/ui-store'
import { STATUS_LABEL, normalizeStatus, presenceForStatus } from '@renderer/lib/user-status'
import { Avatar } from '@renderer/components/common/avatar'
import { UserMenu } from '@renderer/components/common/user-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** The signed-in user's account nav — avatar + name trigger opening the full
 *  `UserMenu` (status, edit profile → settings, copy id, sign out). The same wiring as
 *  the sidebar `UserPanel`, but **without** the voice controls / floating-bar layout,
 *  so it fits a header. Used on pages outside a workspace (e.g. `/workspaces`), which
 *  must also mount `<SettingsDialog />` for "Edit profile" to have somewhere to open. */
export function AccountMenu(): React.JSX.Element {
  const { user, signOut } = useAppAuth()
  const me = useQuery(api.users.me)
  const setPresence = useMutation(api.users.setPresence)
  const setCustomStatus = useMutation(api.users.setCustomStatus)
  const openSettings = useUiStore((state) => state.openSettings)
  const navigate = useNavigate()

  const [menuOpen, setMenuOpen] = useState(false)
  // Lets the popover stay open while the (portaled) status emoji picker is up.
  const emojiGuard = useRef(false)

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ')
  const name = me?.name || fullName || user?.email || 'Account'
  const email = user?.email ?? me?.email ?? ''
  const status = normalizeStatus(me?.presence)
  const initials = initialsOf(name || email || '?')
  const subtitle = me?.statusText
    ? `${me.statusEmoji ? `${me.statusEmoji} ` : ''}${me.statusText}`
    : STATUS_LABEL[status]

  return (
    <Popover
      open={menuOpen}
      onOpenChange={(open) => {
        if (!open && emojiGuard.current) return
        setMenuOpen(open)
      }}
    >
      <PopoverTrigger className="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 text-left transition-colors hover:bg-accent">
        <Avatar
          initials={initials}
          color={me?.color ?? '#5865f2'}
          image={me?.avatarUrl ?? user?.profilePictureUrl}
          presence={presenceForStatus(status)}
          ringClassName="ring-[3px] ring-sidebar"
          className="size-8"
        />
        <div className="hidden min-w-0 leading-tight sm:block">
          <div className="truncate text-sm font-semibold text-foreground">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <CaretDown className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={8} className="w-64">
        <UserMenu
          name={name}
          subtitle={email}
          initials={initials}
          color={me?.color ?? '#5865f2'}
          image={me?.avatarUrl ?? user?.profilePictureUrl}
          userId={me?._id ?? ''}
          status={status}
          statusEmoji={me?.statusEmoji}
          statusText={me?.statusText}
          onSetStatus={(next) => void setPresence({ presence: next })}
          onSetCustomStatus={(emoji, text) => void setCustomStatus({ emoji, text })}
          onEditProfile={() => openSettings('account')}
          onSignOut={signOut}
          onOfflineWorkspaces={() => void navigate({ to: '/local' })}
          onClose={() => setMenuOpen(false)}
          onEmojiOpenChange={(open) => {
            emojiGuard.current = open
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
