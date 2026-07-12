import { useEffect, useState } from 'react'
import { useConvexConnectionState } from 'convex/react'
import { CloudSlash } from '@phosphor-icons/react'

/** Don't flash on a momentary blip — a websocket reconnect is usually instant. */
const GRACE_MS = 1500

/** "Reconnecting…" — Discord and Slack both keep a persistent banner while the
 *  socket is down, because a silently-disconnected chat app is a liar.
 *
 *  Anything you send meanwhile lands in the durable outbox and shows in the
 *  channel as a pending row, so this only has to explain *why*. */
export function ConnectionBanner(): React.JSX.Element | null {
  const { isWebSocketConnected, hasEverConnected } = useConvexConnectionState()
  const [graceOver, setGraceOver] = useState(false)

  // Reset during render (React's documented alternative to a syncing effect) so
  // the next disconnect gets its own grace period rather than showing instantly.
  if (isWebSocketConnected && graceOver) setGraceOver(false)

  useEffect(() => {
    if (isWebSocketConnected) return
    const timer = setTimeout(() => setGraceOver(true), GRACE_MS)
    return () => clearTimeout(timer)
  }, [isWebSocketConnected])

  // Before the first connection this is app startup, not a network problem.
  if (isWebSocketConnected || !graceOver || !hasEverConnected) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-100 flex justify-center p-2">
      <div className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-700 shadow-lg backdrop-blur dark:text-amber-300">
        <CloudSlash className="size-4" weight="fill" />
        Reconnecting… anything you send will go out when you’re back online.
      </div>
    </div>
  )
}
