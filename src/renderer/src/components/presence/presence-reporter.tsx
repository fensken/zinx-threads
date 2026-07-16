import { useEffect } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import { useKeepAlivePresence } from '@renderer/lib/use-keep-alive-presence'
import { usePresenceStore } from '@renderer/store/presence-store'

/** One global presence "room" — a user is online wherever their account is (across
 *  all their workspaces); each workspace's member list intersects this with its own
 *  members. (Per-workspace rooms would scale better but would only show you online in
 *  the workspace you currently have open.) */
const GLOBAL_ROOM = 'global'

/** 2 minutes between heartbeats. A clean app close shows offline **instantly** (a
 *  `sendBeacon` disconnect on unload); a crash / force-quit / network drop times out at
 *  2.5× = ~5 min. The heartbeat keeps firing while the window is minimised or hidden to
 *  the tray, so a backgrounded app stays **online** (Discord/Slack behaviour) — see
 *  `useKeepAlivePresence`; the desktop window's `backgroundThrottling: false` keeps the
 *  timer on cadence while hidden. Cost is ~30 calls/hr per signed-in user — negligible. */
const HEARTBEAT_INTERVAL_MS = 120_000

/** Runs the presence heartbeat for the signed-in user and mirrors the room's live
 *  online set into `presence-store`. Renders nothing. */
function PresenceReporter({ userId }: { userId: string }): null {
  // Heartbeats + a graceful disconnect only on real unload (not on background), and
  // returns the room's live presence list (`undefined` until the first heartbeat lands).
  const state = useKeepAlivePresence(api.presence, GLOBAL_ROOM, userId, HEARTBEAT_INTERVAL_MS)
  const set = usePresenceStore((store) => store.set)

  useEffect(() => {
    if (state === undefined) {
      set(false, new Set())
      return
    }
    set(true, new Set(state.filter((entry) => entry.online).map((entry) => entry.userId)))
  }, [state, set])

  return null
}

/** Mount once (gated on Convex being configured). Starts reporting presence as soon as
 *  the signed-in user's Convex row is known. Renders nothing until then. */
export function PresenceReporterMount(): React.JSX.Element | null {
  const me = useQuery(api.users.me)
  if (!me?._id) return null
  // Key by user id so an account switch remounts the reporter → a fresh presence
  // session (the old one is disconnected on unmount). See useKeepAlivePresence.
  return <PresenceReporter key={me._id} userId={me._id} />
}
