import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { components } from './_generated/api'
import { Presence } from '@convex-dev/presence'
import { requireUser } from './lib/auth'

/**
 * Online/offline liveness via the `@convex-dev/presence` component.
 *
 * This detects whether a user's app is actually **connected** — it's the layer
 * under the user's *manual* status (Online / Away / DND / Invisible): connectivity
 * decides connected-vs-offline, the manual status decides how you look while
 * connected. A closed / crashed app times out and shows offline; on reopen the
 * user's last manual status (and custom status) shows again.
 *
 * Efficient by design — clients only receive updates when someone joins or leaves a
 * room, never on every heartbeat. We use a single **global** room, so a user is
 * "online" wherever their account is (across all their workspaces); each workspace's
 * member list intersects that with its own members. The client hook
 * (`@convex-dev/presence/react` `usePresence`) sends the heartbeats + a graceful
 * disconnect on tab close.
 *
 * ⚠ The file MUST stay `convex/presence.ts` with a `disconnect` export — the client
 * hook's unload `sendBeacon` targets the hardcoded path `"presence:disconnect"`.
 */
export const presence = new Presence(components.presence)

/** Keepalive. Auth-gated: the caller must be signed in AND may only report presence
 *  for THEMSELVES (a signed-in user can't make someone else appear online). Times out
 *  at 2.5× `interval` if heartbeats stop. */
export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number()
  },
  handler: async (ctx, { roomId, userId, sessionId, interval }) => {
    const user = await requireUser(ctx)
    if (userId !== user._id) {
      throw new ConvexError('You can only report your own presence')
    }
    return await presence.heartbeat(ctx, roomId, userId, sessionId, interval)
  }
})

/** The room's live presence list. Kept read-only + free of per-user reads so every
 *  subscriber shares one cache entry (component guidance). */
export const list = query({
  args: { roomToken: v.string() },
  handler: async (ctx, { roomToken }) => {
    return await presence.list(ctx, roomToken)
  }
})

/** Graceful disconnect. Deliberately UNauthenticated: it's called over HTTP from the
 *  browser's `sendBeacon` on tab close, where the auth token can't ride along. The
 *  `sessionToken` (an unguessable capability minted by `heartbeat`) is the authority. */
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    return await presence.disconnect(ctx, sessionToken)
  }
})
