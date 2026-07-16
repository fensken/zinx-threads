import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { CalendarDots, MagnifyingGlass, Tray } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { useUiStore } from '@renderer/store/ui-store'

// Show the platform-correct palette shortcut (⌘ is a Mac glyph — wrong + ugly on
// Windows/Linux). The palette listens for both ⌘K and Ctrl+K.
const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
const SEARCH_SHORTCUT = IS_MAC ? '⌘ + K' : 'Ctrl + K'

/** A top-level sidebar nav row (Search / Inbox / Events). */
export function QuickItem({
  icon,
  label,
  hint,
  badge,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  /** Unread count, right-aligned — the same rose pill a channel row uses. */
  badge?: string | null
  active?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    // Metrics deliberately identical to a channel row (`real-channel-sidebar.tsx`
    // `ChannelRow`): same `gap-1.5`, `rounded-md`, `px-2 py-1` and a `size-4` icon.
    // These sit directly above the channel list, so any difference shows up as the
    // labels failing to line up in a single left-hand column.
    <button
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ' +
        (active
          ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
          : 'text-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground')
      }
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge ? (
        <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {badge}
        </span>
      ) : null}
      {hint ? (
        <kbd className="pointer-events-none inline-flex h-5 items-center rounded-md border border-border/60 bg-background/60 px-1.5 font-sans text-[10px] font-semibold text-muted-foreground">
          {hint}
        </kbd>
      ) : null}
    </button>
  )
}

/** The sidebar's quick-nav block: Search, Inbox and Events.
 *
 *  **The sidebar navigates; the header peeks.** Inbox and Events each have a full
 *  page, and these rows go to it — while the channel header keeps a flyout with the
 *  latest few, for when you want a glance without leaving the channel you're
 *  reading. (Threads are deliberately absent: they belong to a channel, so the
 *  channel header's Threads button is their only entry point.) */
export function SidebarQuickNav({ serverId }: { serverId: string }): React.JSX.Element {
  const togglePalette = useUiStore((s) => s.togglePalette)
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()

  // The same user-wide count the header badge shows — Convex dedupes the two.
  const unread = useQuery(api.inbox.unreadCountForMe, {})
  const badge = unread?.count ? `${unread.count}${unread.overflow ? '+' : ''}` : null

  const onInbox = Boolean(matchRoute({ to: '/w/$workspaceId/inbox', fuzzy: false }))
  const onEvents = Boolean(matchRoute({ to: '/w/$workspaceId/events', fuzzy: false }))

  return (
    <div className="relative space-y-0.5 px-2 pb-1 py-2">
      <QuickItem
        icon={<MagnifyingGlass className="size-4" />}
        label="Search"
        hint={SEARCH_SHORTCUT}
        onClick={togglePalette}
      />
      <QuickItem
        icon={<Tray className="size-4" />}
        label="Inbox"
        badge={badge}
        active={onInbox}
        onClick={() =>
          void navigate({ to: '/w/$workspaceId/inbox', params: { workspaceId: serverId } })
        }
      />
      <QuickItem
        icon={<CalendarDots className="size-4" />}
        label="Events"
        active={onEvents}
        onClick={() =>
          void navigate({ to: '/w/$workspaceId/events', params: { workspaceId: serverId } })
        }
      />
    </div>
  )
}
