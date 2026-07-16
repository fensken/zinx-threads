import { CatchBoundary, Outlet, createRootRoute } from '@tanstack/react-router'
import { AppError } from '@renderer/components/layout/app-error'
import { AuthGate } from '@renderer/components/auth/auth-gate'
import { ConnectionBanner } from '@renderer/components/chat/connection-banner'
import { DeepLinkHandler } from '@renderer/components/layout/deep-link-handler'
import { TitleBar } from '@renderer/components/layout/title-bar'
import { NotificationBridge } from '@renderer/components/inbox/notification-bridge'
import { OutboxFlusher } from '@renderer/components/chat/outbox-flusher'
import { PresenceReporterMount } from '@renderer/components/presence/presence-reporter'
import { Toaster } from '@renderer/components/ui/sonner'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { convexEnabled } from '@renderer/lib/auth-client'
import { useThemeStore } from '@renderer/store/theme-store'

export const Route = createRootRoute({
  component: RootLayout
})

function RootLayout(): React.JSX.Element {
  // The vendored `ui/sonner` reads `next-themes`, which we don't use — pass our
  // resolved theme explicitly (our prop wins, it's spread last).
  const theme = useThemeStore((state) => state.theme)
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  return (
    <TooltipProvider delay={400}>
      {/* Routes `zinx://` deep links ("Open in app") into the router. Desktop-only;
          a no-op on web. Outside AuthGate so it runs regardless of sign-in state. */}
      <DeepLinkHandler />
      {/* The app is a column: our own title bar (desktop; the OS still draws the
          window buttons over it), then everything else. The routes below fill this
          box with `h-full` — the VIEWPORT height lives here and nowhere else, so the
          bar can't push the app off the bottom of the screen. On web the bar renders
          nothing and this is just a full-height wrapper. */}
      <div className="flex h-dvh flex-col overflow-hidden">
        <TitleBar />
        {/* No rule under the title bar. (If one is ever wanted again, it has to live
            HERE as a `border-t`, not as the bar's `border-b` — the OS paints its
            window-button overlay as an opaque rectangle over the top-right of the bar, so
            a border on the bar is covered exactly where the buttons are and stops dead
            mid-window. A border on this element sits below that rectangle.) */}
        {/* The error boundary sits INSIDE the shell, wrapping only the routed content —
            NOT on the root route. A root `errorComponent` replaces `RootLayout` itself,
            which means it also replaces the **title bar** — and on Windows/Linux we draw
            the window controls, so a crash would leave a frameless window with no
            minimise, maximise or close, and no way out but Task Manager. Scoped here, a
            route throw swaps the content pane and leaves the chrome (and the route it
            failed on) intact. `getResetKey` re-arms it on the next navigation, so "Go
            home" actually recovers instead of re-rendering the same error. */}
        <div className="min-h-0 flex-1">
          <CatchBoundary getResetKey={() => 'app'} errorComponent={AppError}>
            <AuthGate>
              <Outlet />
            </AuthGate>
          </CatchBoundary>
        </div>
      </div>
      {/* Both need a `<ConvexProvider>` above them, which only exists when a
          Convex URL is configured. A mock build has no outbox and no socket. */}
      {convexEnabled ? (
        <>
          <OutboxFlusher />
          <ConnectionBanner />
          {/* Sound + OS notification + dock badge for anything new in the inbox.
              Decides WHETHER to interrupt (focused → chime only). */}
          <NotificationBridge />
          {/* Reports this user's online heartbeat + mirrors the global online set into
              presence-store (read via `useIsOnline`). No-op until signed in. */}
          <PresenceReporterMount />
        </>
      ) : null}
      {/* No `closeButton`: it renders a corner ✕ that duplicated the severity icon
          (an X-circle for errors) — two icons on one toast. Toasts auto-dismiss. */}
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-center" richColors />
      {/*{import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}*/}
    </TooltipProvider>
  )
}
