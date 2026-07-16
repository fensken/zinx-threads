import { useEffect, useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

/**
 * The floating user bar at the bottom of the sidebar — the container, the avatar+name
 * trigger, and the width-tracked popover — shared by the online `UserPanel` (Convex identity
 * + voice controls) and the offline `LocalUserBar` (a local profile, no server). The popover
 * always matches the bar's width via a `ResizeObserver`, which was the identical code
 * duplicated in both; owning it here means it can't drift.
 *
 * The caller supplies the avatar (with or without a presence/speaking ring), the menu
 * (popover content), any controls to the right of the trigger (`trailing` — mic/deafen +
 * gear online, just the gear offline), and anything above the bar (`above` — the
 * "Voice Connected" strip online).
 */
export function UserBarShell({
  avatar,
  name,
  subtitle,
  menuOpen,
  onMenuOpenChange,
  menu,
  trailing,
  above
}: {
  avatar: React.ReactNode
  name: string
  subtitle: string
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  /** Popover content — the user menu. */
  menu: React.ReactNode
  /** Controls to the right of the identity trigger. */
  trailing?: React.ReactNode
  /** Rendered above the bar (e.g. the in-call strip). */
  above?: React.ReactNode
}): React.JSX.Element {
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
    <div>
      {above}
      <div
        ref={barRef}
        className="mx-2 mt-1 mb-2 flex items-center gap-0.5 rounded-lg bg-sidebar-accent/60 px-1.5 py-1.5 shadow-sm"
      >
        <Popover open={menuOpen} onOpenChange={onMenuOpenChange}>
          <PopoverTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-sidebar-accent">
            {avatar}
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-sidebar-foreground">{name}</div>
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
            {menu}
          </PopoverContent>
        </Popover>
        {trailing}
      </div>
    </div>
  )
}
