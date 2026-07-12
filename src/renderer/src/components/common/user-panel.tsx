import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Gear } from '@phosphor-icons/react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import { useAppAuth } from '@renderer/lib/use-app-auth'
import { useUiStore } from '@renderer/store/ui-store'
import { useVoiceStore } from '@renderer/store/voice-store'
import {
  STATUS_LABEL,
  normalizeStatus,
  presenceForStatus,
  type UserStatus
} from '@renderer/lib/user-status'
import { Avatar } from '@renderer/components/common/avatar'
import { IconButton } from '@renderer/components/common/icon-button'
import { UserMenu } from '@renderer/components/common/user-menu'
import {
  UserBarMediaButtons,
  VoiceConnectedStrip
} from '@renderer/components/voice/user-voice-controls'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** The signed-in WorkOS user — status persisted to Convex (`users.setPresence` /
 *  `setCustomStatus`); sign out via WorkOS. */
export function UserPanel(): React.JSX.Element {
  const { user, signOut } = useAppAuth()
  const me = useQuery(api.users.me)
  const setPresence = useMutation(api.users.setPresence)
  const setCustomStatus = useMutation(api.users.setCustomStatus)

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ')
  const name = me?.name || fullName || user?.email || 'Account'
  const email = user?.email ?? me?.email ?? ''

  return (
    <UserPanelView
      name={name}
      email={email}
      initials={initialsOf(name || email || '?')}
      color={me?.color ?? '#5865f2'}
      image={me?.avatarUrl ?? user?.profilePictureUrl}
      userId={me?._id ?? ''}
      status={normalizeStatus(me?.presence)}
      statusEmoji={me?.statusEmoji}
      statusText={me?.statusText}
      onSetStatus={(status) => void setPresence({ presence: status })}
      onSetCustomStatus={(emoji, text) => void setCustomStatus({ emoji, text })}
      onSignOut={signOut}
    />
  )
}

function UserPanelView({
  name,
  email,
  initials,
  color,
  image,
  userId,
  status,
  statusEmoji,
  statusText,
  onSetStatus,
  onSetCustomStatus,
  onSignOut
}: {
  name: string
  email: string
  initials: string
  color: string
  image?: string | null
  userId: string
  status: UserStatus
  statusEmoji?: string
  statusText?: string
  onSetStatus: (status: UserStatus) => void
  onSetCustomStatus: (emoji: string | undefined, text: string) => void
  onSignOut?: () => void
}): React.JSX.Element {
  const openSettings = useUiStore((state) => state.openSettings)
  const navigate = useNavigate()
  // Your own avatar glows green while you're talking in a call (Discord-style).
  const speaking = useVoiceStore((state) => state.speakingUserIds.includes(userId))
  const [menuOpen, setMenuOpen] = useState(false)
  // Lets the menu popover stay open while the (portaled) emoji picker is up.
  const emojiGuard = useRef(false)
  // The dropdown always matches the floating bar's width (tracks sidebar resize).
  const barRef = useRef<HTMLDivElement>(null)
  const [barWidth, setBarWidth] = useState<number>()

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setBarWidth(el.offsetWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const subtitle = statusText
    ? `${statusEmoji ? `${statusEmoji} ` : ''}${statusText}`
    : STATUS_LABEL[status]

  return (
    <div>
      {/* When in a voice call, a "Voice Connected" strip sits above the bar with
          camera/screen toggles + disconnect (renders nothing otherwise). */}
      <VoiceConnectedStrip />
      <div
        ref={barRef}
        className="mx-2 mt-1 mb-2 flex items-center gap-0.5 rounded-lg bg-sidebar-accent/60 px-1.5 py-1.5 shadow-sm"
      >
        <Popover
          open={menuOpen}
          onOpenChange={(open) => {
            if (!open && emojiGuard.current) return
            setMenuOpen(open)
          }}
        >
          <PopoverTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-sidebar-accent">
            <span
              className={cn(
                'shrink-0 rounded-full transition-shadow',
                speaking && 'shadow-[0_0_0_2px_#10b981,0_0_10px_rgba(16,185,129,0.6)]'
              )}
            >
              <Avatar
                initials={initials}
                color={color}
                image={image}
                presence={presenceForStatus(status)}
                ringClassName="ring-[3px] ring-sidebar"
                className="size-8"
              />
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-foreground">{name}</div>
              <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
            </div>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            alignOffset={-6}
            sideOffset={8}
            style={{ width: barWidth ?? '16rem' }}
          >
            <UserMenu
              name={name}
              subtitle={email}
              initials={initials}
              color={color}
              image={image}
              userId={userId}
              status={status}
              statusEmoji={statusEmoji}
              statusText={statusText}
              onSetStatus={onSetStatus}
              onSetCustomStatus={onSetCustomStatus}
              onEditProfile={() => openSettings('account')}
              onSignOut={onSignOut}
              onOfflineWorkspaces={() => void navigate({ to: '/local' })}
              onClose={() => setMenuOpen(false)}
              onEmojiOpenChange={(open) => {
                emojiGuard.current = open
              }}
            />
          </PopoverContent>
        </Popover>

        {/* Mic + deafen — wired to the live call when you're in one, plain otherwise. */}
        <UserBarMediaButtons />
        <IconButton label="User settings" onClick={() => openSettings('account')}>
          <Gear className="size-4" />
        </IconButton>
      </div>
    </div>
  )
}
