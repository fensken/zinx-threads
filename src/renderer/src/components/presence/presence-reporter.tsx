import { useEffect } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import usePresence from '@convex-dev/presence/react'
import { api } from '@convex/_generated/api'
import { usePresenceStore } from '@renderer/store/presence-store'

/** One global presence "room" — a user is online wherever their account is (across
 *  all their workspaces); each workspace's member list intersects this with its own
 *  members. (Per-workspace rooms would scale better but would only show you online in
 *  the workspace you currently have open.) */
const GLOBAL_ROOM = 'global'

/** 2 minutes between heartbeats. A clean app close shows offline **instantly** (the
 *  hook fires a `sendBeacon` disconnect); a crash / force-quit / network drop times
 *  out at 2.5× = ~5 min. Cost is ~30 calls/hr per *actively-visible* user (heartbeats
 *  pause entirely when the window is backgrounded), which is negligible. Tune here. */
const HEARTBEAT_INTERVAL_MS = 120_000

/** Runs the presence heartbeat for the signed-in user and mirrors the room's live
 *  online set into `presence-store`. Renders nothing. */
function PresenceReporter({ userId }: { userId: string }): null {
  // Sends heartbeats + a graceful disconnect on tab close / background, and returns
  // the room's live presence list (`undefined` until the first heartbeat lands).
  const state = usePresence(api.presence, GLOBAL_ROOM, userId, HEARTBEAT_INTERVAL_MS)
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
  return <PresenceReporter userId={me._id} />
}
