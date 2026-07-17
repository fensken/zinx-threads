import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Gear, PencilSimple, SignIn } from '@phosphor-icons/react'
import { useLocalStore } from '@renderer/store/local-store'
import { useLocalUiStore } from '@renderer/store/local-ui-store'
import { initialsOf } from '@renderer/lib/initials'
import { Avatar } from '@renderer/components/common/avatar'
import { IconButton } from '@renderer/components/common/icon-button'
import { UserBarShell } from '@renderer/components/common/user-bar-shell'
import { cn } from '@renderer/lib/utils'

/** The floating user bar for offline mode — the SAME shell as the online `UserPanel`
 *  (`UserBarShell`: width-tracked popover, identity trigger), showing the purely-local
 *  offline profile. No presence / voice / custom status (those need an account + server),
 *  so the menu is just Edit profile + Sign in. */
export function LocalUserBar(): React.JSX.Element {
  const profile = useLocalStore((state) => state.profile)
  const openSettings = useLocalUiStore((state) => state.openSettings)
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <UserBarShell
      name={profile.name}
      subtitle="Local"
      menuOpen={menuOpen}
      onMenuOpenChange={setMenuOpen}
      avatar={
        <Avatar
          initials={initialsOf(profile.name)}
          color="#f59e0b"
          image={profile.avatar}
          ringClassName="ring-[3px] ring-sidebar"
          className="size-8"
        />
      }
      trailing={
        <IconButton label="Local settings" onClick={() => openSettings('profile')}>
          <Gear className="size-4" />
        </IconButton>
      }
      menu={
        <div className="flex w-full flex-col">
          {/* Identity — same shape as the online UserMenu. */}
          <div className="flex items-center gap-3 px-1.5 pt-1 pb-2">
            <Avatar
              initials={initialsOf(profile.name)}
              color="#f59e0b"
              image={profile.avatar}
              ringClassName="ring-2 ring-popover"
              className="size-11"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{profile.name}</div>
              <div className="truncate text-xs text-muted-foreground">Local · this device</div>
            </div>
          </div>

          <Divider />

          <Row
            onClick={() => {
              setMenuOpen(false)
              openSettings('profile')
            }}
          >
            <PencilSimple className="size-4 text-muted-foreground" />
            <span className="flex-1">Edit profile</span>
          </Row>
          <Row
            onClick={() => {
              setMenuOpen(false)
              void navigate({ to: '/' })
            }}
          >
            <SignIn className="size-4 text-muted-foreground" />
            <span className="flex-1">Sign in to the online app</span>
          </Row>
        </div>
      }
    />
  )
}

/** Same row styling as the online UserMenu. */
function Row({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
        'hover:bg-accent hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function Divider(): React.JSX.Element {
  return <div className="my-1 h-px bg-border" />
}
