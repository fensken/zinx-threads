import { useEffect, useRef, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { CaretLeft, CaretRight, MagnifyingGlass, SidebarSimple } from '@phosphor-icons/react'
import { Logo } from '@renderer/components/layout/logo'
import { UpdateBadge } from '@renderer/components/layout/update-badge'
import { WindowControls } from '@renderer/components/layout/window-controls'
import { hasCustomTitleBar, windowControlsStyle } from '@renderer/lib/platform'
import { useMediaQuery } from '@renderer/lib/use-media-query'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/store/ui-store'

const IS_MAC = windowControlsStyle === 'native'
const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl+K'

/**
 * The app's own title bar (Slack/Discord/VS Code do the same).
 *
 * **Who draws the window buttons differs per platform, on purpose** — see
 * `windowControlsStyle`. Windows/Linux: ours (`window-controls.tsx`), themed, in a
 * `frame: false` window. macOS: the native traffic lights, never redrawn, just inset into
 * this taller bar.
 *
 * Two layout rules make it work:
 *  - dragging is opt-**in**: the bar is a drag region (`.app-drag`), and everything
 *    clickable inside it opts back out (`.app-no-drag`), or the drag handler eats the
 *    click. That includes the window controls themselves.
 *  - macOS needs a left inset to clear the traffic lights, which the OS draws at a fixed
 *    physical size — one of the few legitimately-px values in the app.
 *
 * Contents are deliberately minimal: the controls that act on the **window** (collapse
 * the sidebar, go back/forward) plus global search. No workspace name — the sidebar's
 * switcher already says which workspace you're in, in bigger type, just below.
 *
 * Renders nothing on web, where the browser already has chrome.
 */
export function TitleBar(): React.JSX.Element | null {
  const togglePalette = useUiStore((state) => state.togglePalette)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)

  // The sidebar toggle only belongs here on routes that HAVE a sidebar (the workspace
  // shell and the offline workspace) — not sign-in or onboarding — and only at `md+`,
  // where the sidebar is an inline column. Below `md` it's a drawer, and the drawer's
  // hamburger stays in the page header next to the content it overlays.
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const isMdUp = useMediaQuery('(min-width: 768px)')
  const showSidebarToggle = (pathname.startsWith('/w/') || pathname.startsWith('/local')) && isMdUp

  const router = useRouter()
  const nav = useNavState()

  if (!hasCustomTitleBar) return null

  return (
    <div
      // The bar IS the drag handle. `h-11` (not a px height) so it scales with the UI
      // like everything else.
      className="app-drag relative flex h-11 shrink-0 items-center justify-between gap-1 bg-titlebar text-muted-foreground"
      style={{
        // macOS: clear the traffic lights. Elsewhere our own buttons sit at the end of
        // this flex row, so nothing has to be reserved.
        paddingLeft: IS_MAC ? 78 : 4
      }}
    >
      {/* History first, then the sidebar toggle — the two navigation controls sit together,
          with the toggle on the RIGHT of the arrows so it's the one closest to the search
          box and to the column it opens. Both are disabled when there's genuinely nowhere
          to go: a button that does nothing when pressed is worse than one that says so.
          Their action and their state both go through the ROUTER's history, not
          `window.history` — see `useNavState`. */}
      <div className="flex shrink-0 items-center gap-0.5">
        <BarButton label="Back" onClick={() => router.history.back()} disabled={!nav.canGoBack}>
          <CaretLeft className="size-4" weight="bold" />
        </BarButton>
        <BarButton
          label="Forward"
          onClick={() => router.history.forward()}
          disabled={!nav.canGoForward}
        >
          <CaretRight className="size-4" weight="bold" />
        </BarButton>

        {/* Collapse / show the channel sidebar (persisted). It lives in the title bar, not
            the page header, because it acts on the window's chrome rather than the channel. */}
        {showSidebarToggle ? (
          <BarButton
            label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            onClick={toggleSidebar}
            className={cn(sidebarCollapsed && 'text-foreground')}
          >
            <SidebarSimple className="size-4" />
          </BarButton>
        ) : null}
      </div>

      {/* Search — the one thing Slack puts in its bar, and the only global action worth a
          permanent home. Shaped like the compact composer so the app's two "type here"
          boxes read as the same control. Opens the ⌘K palette.

          **Absolutely centred on the WINDOW**, not `mx-auto` between the side controls: the
          left group (history + sidebar) and the right window buttons have different widths,
          so `mx-auto` would sit it off-centre. `left-1/2 -translate-x-1/2` puts it dead
          centre regardless; `max-w` keeps it clear of the side controls at the min width. */}
      {/* The app mark sits immediately left of the search box, and the two are centred as one
          unit (so the search shifts a hair right of dead-centre — the logo is the counterweight).
          The mark is `pointer-events-none` so it neither steals clicks nor drags as an image; the
          bar behind it stays a window-drag handle. */}
      <div className="absolute top-1/2 left-1/2 flex max-w-[calc(100%-14rem)] -translate-x-1/2 -translate-y-1/2 items-center gap-2">
        <Logo className="pointer-events-none size-6 shrink-0 rounded-md" />
        <button
          type="button"
          onClick={togglePalette}
          className="app-no-drag flex h-8 w-[28rem] max-w-full items-center gap-2 rounded-lg bg-titlebar-accent px-2.5 text-xs text-muted-foreground transition-colors hover:bg-titlebar-accent/70 hover:text-foreground"
        >
          <MagnifyingGlass className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">Search</span>
          <kbd className="pointer-events-none shrink-0 font-sans text-[0.6875rem] font-semibold opacity-70">
            {SEARCH_SHORTCUT}
          </kbd>
        </button>
      </div>

      {/* Right cluster: the "Update available" pill sits just LEFT of the window action
          buttons. On macOS (no buttons on this side) it's flush to the right edge. */}
      <div className="flex shrink-0 items-center gap-1 pl-1">
        <UpdateBadge />
        {/* Windows/Linux: our minimise / maximise / close, flush to the corner. macOS:
            renders nothing (the traffic lights are already at the other end). */}
        <WindowControls />
      </div>
    </div>
  )
}

/**
 * Whether back / forward have anywhere to go.
 *
 * **`window.history` cannot answer this.** It exposes a `length` but no cursor — there is
 * no `canGoBack()` in the DOM, by design (it would leak the user's browsing history). So
 * `window.history.back()` is a call into the dark: it silently does nothing at the start
 * of the stack, and there's no way to know beforehand.
 *
 * TanStack Router keeps its **own** index in `history.state.__TSR_index` precisely
 * because of that, and exposes `canGoBack()`. That's the SPA's real source of truth, so
 * both the buttons' state *and* their action go through `router.history` — not the DOM,
 * and not (as this first tried) an IPC call into Electron's `navigationHistory`, which
 * knows about the *window's* navigations and is a layer below the one we care about.
 *
 * Forward has no `canGoForward()`, so we derive it: remember the furthest index reached,
 * and we can go forward whenever we're behind it. A **push truncates the forward stack**
 * (browser semantics — navigate somewhere new after going back and the forward entries
 * are gone), so a PUSH resets the high-water mark to the current index.
 */
function useNavState(): { canGoBack: boolean; canGoForward: boolean } {
  const router = useRouter()
  const [nav, setNav] = useState({ canGoBack: false, canGoForward: false })
  const furthest = useRef(0)

  useEffect(() => {
    const history = router.history
    const read = (action?: string): void => {
      const index = (history.location.state as { __TSR_index?: number })?.__TSR_index ?? 0
      furthest.current = action === 'PUSH' ? index : Math.max(furthest.current, index)
      setNav({ canGoBack: history.canGoBack(), canGoForward: index < furthest.current })
    }
    read()
    return history.subscribe(({ action }) => read(action?.type))
  }, [router])

  return nav
}

function BarButton({
  label,
  onClick,
  disabled,
  className,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'app-no-drag flex size-7 shrink-0 items-center justify-center rounded transition-colors',
        'hover:bg-titlebar-accent hover:text-foreground',
        // Not `opacity-50`: a disabled control should read as unavailable, not as the
        // whole button faded. And no hover response — nothing would happen.
        'disabled:pointer-events-none disabled:text-muted-foreground',
        className
      )}
    >
      {children}
    </button>
  )
}
