import { SidebarSimple } from '@phosphor-icons/react'
import { IconButton } from '@renderer/components/common/icon-button'
import { hasCustomTitleBar } from '@renderer/lib/platform'
import { useUiStore } from '@renderer/store/ui-store'

/**
 * Collapse / show the channel sidebar (desktop-width only; below `md` the sidebar is a
 * drawer with its own hamburger).
 *
 * **On desktop this renders nothing** — the title bar owns the toggle there, sitting at
 * the far left directly above the column it opens and closes, which is where window
 * chrome belongs. But the **web** build has no title bar (the browser draws its own), so
 * the page header is the only place the control can live. Same store, same behaviour;
 * only its home changes.
 *
 * This is one component rather than five copies of the same markup: every page header
 * (channel, DM, inbox, events, offline) carried an identical button, and the rule about
 * *where* it lives now lives in exactly one place.
 */
export function SidebarToggle(): React.JSX.Element | null {
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)

  if (hasCustomTitleBar) return null

  return (
    <>
      <IconButton
        label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        active={sidebarCollapsed}
        className="hidden md:flex"
        onClick={toggleSidebar}
      >
        <SidebarSimple className="size-5" />
      </IconButton>
      {/* Nav chrome and the page's identity (its icon + name) are two different things
          sitting at the same size — without a rule between them the channel's `#` reads
          as a third button. */}
      <span className="mx-0.5 hidden h-5 w-px shrink-0 bg-border md:block" />
    </>
  )
}
