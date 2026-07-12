import '@fontsource-variable/funnel-display' // self-hosted UI font (matches _zinx)
import './assets/globals.css'
import './store/theme-store' // applies the persisted/default theme before first render
import './store/settings-store' // applies the persisted UI scale (root font-size) before first render

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { router } from './router'
import { isElectron } from './lib/platform'
import { initDesktopAuth } from './lib/desktop-auth'
import { AuthProviders } from './components/auth/auth-providers'

// Convex client, created once at module scope. Everything is env-guarded so the
// app degrades gracefully:
//   • no VITE_CONVEX_URL          → mock-data mode, no providers
//   • Convex URL, no WorkOS env   → ConvexProvider (data only, unauthenticated)
//   • Convex URL + WorkOS env      → WorkOS AuthKit → Convex (full auth)
// The WorkOS vars are written to .env.local by Convex AuthKit auto-provision
// (SETUP.md / convex.json), so auth activates automatically once that's run.
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
const workosClientId = import.meta.env.VITE_WORKOS_CLIENT_ID as string | undefined
const workosRedirectUri = import.meta.env.VITE_WORKOS_REDIRECT_URI as string | undefined
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

// StrictMode wraps ONLY the app (router), not the auth/Convex providers below it.
// In dev, StrictMode double-invokes effects — which for the WorkOS web flow would run
// the `/callback` code exchange twice; an auth code is single-use, so the 2nd exchange
// fails ("authorization code already used") and leaves you signed out on the callback
// page. Keeping the providers OUTSIDE StrictMode makes their init effect fire once (as
// in production) while the app UI still gets StrictMode's dev checks.
const tree = (
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)

/** Holds a query's subscription open for a while after the last component using
 *  it unmounts, so navigating back to a channel you just left renders instantly
 *  instead of flashing a spinner.
 *
 *  Convex's own `useQuery` drops the subscription on unmount — it's a live
 *  socket, not a cache — which is why every channel switch refetched from
 *  scratch. Entries stay **subscribed** while cached, so this is not stale data:
 *  a channel you return to is current, not a snapshot. Components opt in by
 *  importing `useQuery` from `convex-helpers/react/cache/hooks`.
 *
 *  Defaults are `expiration: 300_000` (5 min) and `maxIdleEntries: 250` (LRU). */
const cached = (children: React.ReactNode): React.JSX.Element => (
  <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
)

let root = tree
if (convex && workosClientId && workosRedirectUri) {
  // Desktop: configure main's auth (client id) + load the persisted session BEFORE
  // Convex mounts, so its first token fetch never races an unconfigured main process.
  // On web this is a no-op (authkit-react handles auth). See lib/desktop-auth.ts.
  if (isElectron) initDesktopAuth(workosClientId)
  root = (
    <AuthProviders convex={convex} clientId={workosClientId} redirectUri={workosRedirectUri}>
      {cached(tree)}
    </AuthProviders>
  )
} else if (convex) {
  root = <ConvexProvider client={convex}>{cached(tree)}</ConvexProvider>
}

createRoot(document.getElementById('root')!).render(root)
