import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Gear, PencilSimple, SignIn } from '@phosphor-icons/react'
import { useLocalStore } from '@renderer/store/local-store'
import { useLocalUiStore } from '@renderer/store/local-ui-store'
import { initialsOf } from '@renderer/lib/initials'
import { Avatar } from '@renderer/components/common/avatar'
import { IconButton } from '@renderer/components/common/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'

/** The floating user bar for offline mode — the SAME shape and behaviour as the
 *  online `UserPanel`/`UserMenu` (width-tracked popover, identity header, menu
 *  rows), showing the purely-local offline profile. No mic/deafen or presence
 *  (voice + status need an account/server). */
export function LocalUserBar(): React.JSX.Element {
  const profile = useLocalStore((state) => state.profile)
  const openSettings = useLocalUiStore((state) => state.openSettings)
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  // The dropdown always matches the floating bar's width (tracks sidebar resize) —
  // exactly as the online UserPanel does.
  const barRef = useRef<HTMLDivElement>(null)
  const [barWidth, setBarWidth] = useState<number>()

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setBarWidth(el.offsetWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={barRef}
      className="mx-2 mt-1 mb-2 flex items-center gap-0.5 rounded-lg bg-sidebar-accent/60 px-1.5 py-1.5 shadow-sm"
    >
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-sidebar-accent">
          <Avatar
            initials={initialsOf(profile.name)}
            color="#f59e0b"
            image={profile.avatar}
            ringClassName="ring-[3px] ring-sidebar"
            className="size-8"
          />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold text-foreground">{profile.name}</div>
            <div className="truncate text-xs text-muted-foreground">Offline</div>
          </div>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          alignOffset={-6}
          sideOffset={8}
          style={{ width: barWidth ?? '16rem' }}
        >
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
                <div className="truncate text-xs text-muted-foreground">Offline · this device</div>
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
        </PopoverContent>
      </Popover>

      <IconButton label="Offline settings" onClick={() => openSettings('profile')}>
        <Gear className="size-4" />
      </IconButton>
    </div>
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
