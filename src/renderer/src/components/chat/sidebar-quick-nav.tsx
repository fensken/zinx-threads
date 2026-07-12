import { CalendarDots, ChatsCircle, MagnifyingGlass, Tray } from '@phosphor-icons/react'
import { useUiStore } from '@renderer/store/ui-store'
import { NavEmptyState, NavFlyout } from '@renderer/components/chat/nav-flyout'

// Show the platform-correct palette shortcut (⌘ is a Mac glyph — wrong + ugly on
// Windows/Linux). The palette listens for both ⌘K and Ctrl+K.
const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
const SEARCH_SHORTCUT = IS_MAC ? '⌘ + K' : 'Ctrl + K'

/** A top-level sidebar nav row (Search / Inbox / Threads / Events). */
export function QuickItem({
  icon,
  label,
  hint,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  active?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ' +
        (active
          ? 'bg-sidebar-accent text-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground')
      }
    >
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint ? (
        <kbd className="pointer-events-none inline-flex h-5 items-center rounded-md border border-border/60 bg-background/60 px-1.5 font-sans text-[10px] font-semibold text-muted-foreground">
          {hint}
        </kbd>
      ) : null}
    </button>
  )
}

/** The sidebar's top-level quick-nav block: Search (⌘K palette), Inbox, Threads,
 *  and Events, above the channel groups. Shared by the mock and Convex sidebars
 *  so both keep the identical layout. Inbox/Threads toggle the channel-**header**
 *  popovers (same in both); Events (which has no header button) opens a right-side
 *  flyout anchored here — a placeholder until the events backend lands. */
export function SidebarQuickNav(): React.JSX.Element {
  const togglePalette = useUiStore((s) => s.togglePalette)
  const setInboxOpen = useUiStore((s) => s.setInboxOpen)
  const setThreadsOpen = useUiStore((s) => s.setThreadsOpen)
  const eventsOpen = useUiStore((s) => s.eventsOpen)
  const setEventsOpen = useUiStore((s) => s.setEventsOpen)

  return (
    <div className="relative space-y-0.5 px-2 pb-1">
      <QuickItem
        icon={<MagnifyingGlass className="size-5" />}
        label="Search"
        hint={SEARCH_SHORTCUT}
        onClick={togglePalette}
      />
      <QuickItem
        icon={<Tray className="size-5" />}
        label="Inbox"
        onClick={() => setInboxOpen(true)}
      />
      <QuickItem
        icon={<ChatsCircle className="size-5" />}
        label="Threads"
        onClick={() => setThreadsOpen(true)}
      />
      <QuickItem
        icon={<CalendarDots className="size-5" />}
        label="Events"
        active={eventsOpen}
        onClick={() => setEventsOpen(!eventsOpen)}
      />

      {eventsOpen ? (
        <NavFlyout
          title="Events"
          className="top-0 left-full ml-2"
          onClose={() => setEventsOpen(false)}
        >
          <NavEmptyState
            icon={<CalendarDots className="size-5" />}
            title="No upcoming events"
            message="Schedule calls and meetups for your workspace — coming soon."
          />
        </NavFlyout>
      ) : null}
    </div>
  )
}
