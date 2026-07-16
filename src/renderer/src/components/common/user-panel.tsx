import { useRef, useState } from 'react'
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
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { IconButton } from '@renderer/components/common/icon-button'
import { UserMenu } from '@renderer/components/common/user-menu'
import { UserBarShell } from '@renderer/components/common/user-bar-shell'
import {
  UserBarMediaButtons,
  VoiceConnectedStrip
} from '@renderer/components/voice/user-voice-controls'
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
      color={me?.color ?? FALLBACK_AVATAR_COLOR}
      image={me?.avatarUrl ?? user?.profilePictureUrl}
      userId={me?._id ?? ''}
      timezone={me?.timezone}
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
  timezone,
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
  timezone?: string
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

  const subtitle = statusText
    ? `${statusEmoji ? `${statusEmoji} ` : ''}${statusText}`
    : STATUS_LABEL[status]

  return (
    <UserBarShell
      name={name}
      subtitle={subtitle}
      menuOpen={menuOpen}
      onMenuOpenChange={(open) => {
        if (!open && emojiGuard.current) return
        setMenuOpen(open)
      }}
      // A "Voice Connected" strip with camera/screen toggles + disconnect when you're in a
      // call (renders nothing otherwise).
      above={<VoiceConnectedStrip />}
      avatar={
        <span
          className={cn('shrink-0 rounded-full transition-shadow', speaking && 'speaking-ring')}
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
      }
      trailing={
        <>
          {/* Mic + deafen — wired to the live call when you're in one, plain otherwise. */}
          <UserBarMediaButtons />
          <IconButton label="User settings" onClick={() => openSettings('account')}>
            <Gear className="size-4" />
          </IconButton>
        </>
      }
      menu={
        <UserMenu
          name={name}
          subtitle={email}
          initials={initials}
          color={color}
          image={image}
          userId={userId}
          timezone={timezone}
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
      }
    />
  )
}
