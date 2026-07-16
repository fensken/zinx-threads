import { useRouter } from '@tanstack/react-router'
import { ArrowClockwise, House, WarningCircle } from '@phosphor-icons/react'
import { Button } from '@renderer/components/ui/button'

/**
 * The app's last line of defence, mounted as the root route's `errorComponent`.
 *
 * Without one, a render-time throw unmounts the whole tree and leaves a **blank
 * window** — and on desktop there's no address bar and no reload button, so the only
 * way out is to quit the app. That's not a hypothetical: `useQuery` re-throws query
 * errors *during render*, and several routes cast a raw URL segment straight to an
 * `Id<'…'>` (a thread permalink, a DM link, anything arriving through a `zinx://` deep
 * link). A malformed segment fails Convex's `v.id()` validator, and the app vanishes.
 *
 * So: say something went wrong, offer the two ways out, and — per the error-handling
 * rules — **never show the user the error object**. The stack goes to the console.
 */
export function AppError({ error }: { error: Error }): React.JSX.Element {
  const router = useRouter()
  console.error('[app] unhandled render error', error)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8 text-center">
      <WarningCircle className="size-10 text-muted-foreground" weight="duotone" />
      <div className="space-y-1">
        <p className="font-semibold">Something went wrong</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          This screen couldn’t be opened. Your messages are safe — try again, or go back to your
          workspace.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.invalidate()}>
          <ArrowClockwise className="size-4" />
          Try again
        </Button>
        <Button onClick={() => void router.navigate({ to: '/' })}>
          <House className="size-4" />
          Go home
        </Button>
      </div>
    </div>
  )
}
