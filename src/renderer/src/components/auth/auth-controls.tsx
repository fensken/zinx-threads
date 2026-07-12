import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { useAppAuth } from '@renderer/lib/use-app-auth'

/** WorkOS sign-in / sign-out. Only mount when `authEnabled` (see lib/auth-client.ts):
 *  it calls `useAppAuth`, which on web requires the AuthKit provider. */
export function AuthControls(): React.JSX.Element {
  const { user, isLoading, signIn, signOut } = useAppAuth()

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Checking session…
      </p>
    )
  }
  if (!user) {
    return (
      <Button size="sm" onClick={signIn}>
        Sign in
      </Button>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0 truncate text-sm text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{user.email}</span>
      </p>
      <Button variant="outline" size="sm" onClick={signOut}>
        Sign out
      </Button>
    </div>
  )
}
