import { Link } from '@tanstack/react-router'
import { WifiSlash } from '@phosphor-icons/react'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { Logo } from '@renderer/components/layout/logo'
import { useAppAuth } from '@renderer/lib/use-app-auth'
import { isElectron } from '@renderer/lib/platform'

/** Full-screen sign-in shown to signed-out users (rendered inside <Unauthenticated>).
 *  Sign-in is in-app everywhere — desktop opens a dedicated WorkOS login window, web
 *  redirects the tab. Also offers the no-account **offline workspace**. */
export function SignInPage(): React.JSX.Element {
  const { isLoading, signIn } = useAppAuth()

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-8 bg-sidebar p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo className="size-16 rounded-2xl shadow-lg" />
        <h1 className="text-2xl font-bold">Welcome to Zinx Threads</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Team chat, docs, and boards in one place. Sign in to reach your workspaces.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button size="lg" className="min-w-56 gap-2" disabled={isLoading} onClick={signIn}>
          {isLoading ? (
            <>
              <Spinner className="size-4" />
              Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </Button>
        {/* No-account, local-only pages + boards — DESKTOP ONLY: it persists to disk
            and hosts the local AI assistant, neither of which a browser tab can do, so
            offline mode isn't offered on web. */}
        {isElectron ? (
          <Link
            to="/local"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <WifiSlash className="size-4" />
            Work offline without an account
          </Link>
        ) : null}
      </div>
    </div>
  )
}
