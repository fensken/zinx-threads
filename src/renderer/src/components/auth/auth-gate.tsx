import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react'
import { useRouterState } from '@tanstack/react-router'
import { authEnabled } from '@renderer/lib/auth-client'
import { Spinner } from '@renderer/components/ui/spinner'
import { SignInPage } from '@renderer/components/auth/sign-in-page'
import { UserHydrator } from '@renderer/components/auth/user-hydrator'

/** Gates the whole app behind WorkOS auth (Convex-verified). Two passthroughs:
 *  the **offline workspace** (`/local*`) is a deliberate no-auth, local-only
 *  experience; and a no-backend build (`authEnabled` false) has nothing to gate. */
export function AuthGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  // Offline mode needs no account — render it straight through.
  if (pathname.startsWith('/local')) return <>{children}</>
  if (!authEnabled) return <>{children}</>

  return (
    <>
      <AuthLoading>
        <div className="flex h-dvh items-center justify-center bg-sidebar">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignInPage />
      </Unauthenticated>
      <Authenticated>
        <UserHydrator />
        {children}
      </Authenticated>
    </>
  )
}
