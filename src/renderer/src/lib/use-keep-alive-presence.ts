import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import type { PresenceAPI, PresenceState } from '@convex-dev/presence/react'

/**
 * Single-flight: only one invocation of `fn` runs at a time; a call made while one is
 * in flight queues the LATEST args and runs once the current one finishes. Inlined
 * from `@convex-dev/presence`'s internal helper (it isn't a public export), kept so
 * this fork behaves exactly like the upstream heartbeat under overlap.
 */
function useSingleFlight<Args extends unknown[]>(
  fn: (...args: Args) => Promise<unknown>
): (...args: Args) => Promise<unknown> {
  const status = useRef<{
    inFlight: boolean
    upNext: null | { args: Args; resolve: (v: unknown) => void; reject: (e: unknown) => void }
  }>({ inFlight: false, upNext: null })

  return useCallback(
    (...args: Args) => {
      if (status.current.inFlight) {
        return new Promise((resolve, reject) => {
          status.current.upNext = { args, resolve, reject }
        })
      }
      status.current.inFlight = true
      const first = fn(...args)
      void (async () => {
        try {
          await first
        } finally {
          /* move on to the next request regardless of outcome */
        }
        while (status.current.upNext) {
          const next = status.current.upNext
          status.current.upNext = null
          await fn(...next.args)
            .then(next.resolve)
            .catch(next.reject)
        }
        status.current.inFlight = false
      })()
      return first
    },
    [fn]
  )
}

/**
 * Presence that stays ONLINE while the window is minimised or hidden to the tray.
 *
 * A fork of `@convex-dev/presence`'s `usePresence` with its visibility handling
 * removed: upstream clears the heartbeat and gracefully disconnects on
 * `visibilitychange → hidden`, so a backgrounded desktop app read as **offline** to
 * everyone else — which contradicts "keep running in the background" (Discord/Slack
 * stay online in the tray). Here the heartbeat keeps firing regardless of visibility,
 * and we only disconnect on a real page unload (quit) or unmount. A crash /
 * force-quit / network drop still times out server-side at 2.5× the interval.
 *
 * The desktop window sets `backgroundThrottling: false` so the heartbeat timer keeps
 * its cadence while hidden (Chromium otherwise throttles background timers, which for
 * a long interval could stretch it toward the 2.5× timeout). The upstream hook has no
 * option to opt out of the visibility disconnect, which is why this is a fork rather
 * than configuration.
 *
 * **Remount this per `(roomId, userId)`** — the caller keys the reporter by `userId`
 * (`roomId` is a constant). A fresh session id comes from the mount initializer and
 * the unmount cleanup disconnects the old session, so there's no in-place session
 * reset (which the upstream hook did with a `setState` inside an effect).
 */
export function useKeepAlivePresence(
  presence: PresenceAPI,
  roomId: string,
  userId: string,
  interval = 10_000
): PresenceState[] | undefined {
  const hasMounted = useRef(false)
  const convex = useConvex()
  const baseUrl = convex.url
  // Unique per mount; the caller remounts (via `key`) when the user changes.
  const [sessionId] = useState(() => crypto.randomUUID())
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const sessionTokenRef = useRef<string | null>(null)
  const [roomToken, setRoomToken] = useState<string | null>(null)
  const roomTokenRef = useRef<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartbeat = useSingleFlight(useMutation(presence.heartbeat))
  const disconnect = useSingleFlight(useMutation(presence.disconnect))

  useEffect(() => {
    sessionTokenRef.current = sessionToken
    roomTokenRef.current = roomToken
  }, [sessionToken, roomToken])

  useEffect(() => {
    const sendHeartbeat = async (): Promise<void> => {
      const result = (await heartbeat({ roomId, userId, sessionId, interval })) as {
        roomToken: string
        sessionToken: string
      }
      setRoomToken(result.roomToken)
      setSessionToken(result.sessionToken)
    }
    void sendHeartbeat()
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => void sendHeartbeat(), interval)

    // A real page unload (app quit / tab close) disconnects instantly via a keepalive
    // beacon. There is deliberately NO `visibilitychange` handler — minimising or
    // hiding to the tray must NOT disconnect, which is the whole point of this fork.
    const handleUnload = (): void => {
      if (!sessionTokenRef.current) return
      const blob = new Blob(
        [
          JSON.stringify({
            path: 'presence:disconnect',
            args: { sessionToken: sessionTokenRef.current }
          })
        ],
        { type: 'application/json' }
      )
      navigator.sendBeacon(`${baseUrl}/api/mutation`, blob)
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener('beforeunload', handleUnload)
      // Don't disconnect on the first (React strict-mode) render.
      if (hasMounted.current && sessionTokenRef.current) {
        void disconnect({ sessionToken: sessionTokenRef.current })
      }
    }
  }, [heartbeat, disconnect, roomId, userId, baseUrl, interval, sessionId])

  useEffect(() => {
    hasMounted.current = true
  }, [])

  const state = useQuery(presence.list, roomToken ? { roomToken } : 'skip')
  return useMemo(
    () =>
      state?.slice().sort((a, b) => {
        if (a.userId === userId) return -1
        if (b.userId === userId) return 1
        return 0
      }),
    [state, userId]
  )
}
