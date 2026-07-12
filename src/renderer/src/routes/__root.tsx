import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { AuthGate } from '@renderer/components/auth/auth-gate'
import { ConnectionBanner } from '@renderer/components/chat/connection-banner'
import { DeepLinkHandler } from '@renderer/components/layout/deep-link-handler'
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
      <AuthGate>
        <Outlet />
      </AuthGate>
      {/* Both need a `<ConvexProvider>` above them, which only exists when a
          Convex URL is configured. A mock build has no outbox and no socket. */}
      {convexEnabled ? (
        <>
          <OutboxFlusher />
          <ConnectionBanner />
          {/* Reports this user's online heartbeat + mirrors the global online set into
              presence-store (read via `useIsOnline`). No-op until signed in. */}
          <PresenceReporterMount />
        </>
      ) : null}
      {/* No `closeButton`: it renders a corner ✕ that duplicated the severity icon
          (an X-circle for errors) — two icons on one toast. Toasts auto-dismiss. */}
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-center" richColors />
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </TooltipProvider>
  )
}
