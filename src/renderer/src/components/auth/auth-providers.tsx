import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react'
import { ConvexProviderWithAuthKit } from '@convex-dev/workos'
import { ConvexProviderWithAuth, type ConvexReactClient } from 'convex/react'
import { isElectron } from '@renderer/lib/platform'
import { useConvexDesktopAuth } from '@renderer/lib/use-app-auth'

/**
 * WorkOS + Convex auth providers — one shape, chosen per target:
 *
 *  • **Desktop (Electron)** — auth runs in the MAIN process (PKCE + OS-keychain token
 *    vault + in-app login window; see src/main/auth.ts). Convex reads the access token
 *    over IPC via `useConvexDesktopAuth`, so the renderer holds no tokens and there's no
 *    authkit-react, no localStorage session, no `file://`/redirect juggling. Sessions
 *    persist because the vault does. Dev and packaged take the exact same path.
 *  • **Web** — a real browser SPA, so authkit-react's standard redirect flow + its
 *    `ConvexProviderWithAuthKit` is the right tool. `devMode` keeps the refresh token in
 *    localStorage so a reload re-authenticates silently.
 */
export function AuthProviders({
  convex,
  clientId,
  redirectUri,
  children
}: {
  convex: ConvexReactClient
  clientId: string
  redirectUri: string
  children: React.ReactNode
}): React.JSX.Element {
  if (isElectron) {
    return (
      <ConvexProviderWithAuth client={convex} useAuth={useConvexDesktopAuth}>
        {children}
      </ConvexProviderWithAuth>
    )
  }

  return (
    <AuthKitProvider clientId={clientId} redirectUri={redirectUri} devMode>
      <ConvexProviderWithAuthKit client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithAuthKit>
    </AuthKitProvider>
  )
}
