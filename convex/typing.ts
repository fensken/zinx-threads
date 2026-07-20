import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { getChannelAccess, getCurrentUser } from './lib/auth'

// Live "someone is typing…" indicators. Client-reported and self-expiring, exactly
// like `voicePresence`: the composer calls `start` (throttled to ~once per KEEPALIVE
// while you keep typing) and `stop` on send/blur. `listByChannel` returns only rows
// touched within the TTL and never the caller's own — a crashed client leaves one
// row that drops out of the query within `TYPING_TTL_MS`.
//
// Access is gated by `getChannelAccess`, so you can't broadcast typing into a private
// channel (or a DM) you're not a member of — the same chokepoint messages use.

const TYPING_TTL_MS = 6_000 // a row older than this is "stopped"; client re-pings every ~3s

/** Report that the caller is typing in `channelId` (upsert, throttled by the client). */
export const start = mutation({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return
    const access = await getChannelAccess(ctx, channelId, user._id)
    // Silently no-op rather than throw — a typing ping is best-effort and must never
    // surface an error to the person typing. Only real chat/DM channels have a composer.
    if (!access) return
    const kind = access.channel.kind
    if (kind !== 'chat' && kind !== 'dm') return

    const existing = await ctx.db
      .query('typingStatus')
      .withIndex('by_user_channel', (q) => q.eq('userId', user._id).eq('channelId', channelId))
      .unique()
    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, { updatedAt: now })
    } else {
      await ctx.db.insert('typingStatus', {
        userId: user._id,
        // The row is keyed to the caller's home workspace via the channel; it's only
        // ever read per-channel, so this is just for the channel-delete cascade.
        workspaceId: access.channel.workspaceId,
        channelId,
        updatedAt: now
      })
    }
  }
})

/** Report that the caller stopped typing in `channelId` (removes their row). */
export const stop = mutation({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return
    const existing = await ctx.db
      .query('typingStatus')
      .withIndex('by_user_channel', (q) => q.eq('userId', user._id).eq('channelId', channelId))
      .unique()
    if (existing) await ctx.db.delete(existing._id)
  }
})

/** Who (other than you) is currently typing in `channelId` — their effective display
 *  name, for the "Alice is typing…" line. Access-gated + null-safe; stale rows dropped. */
export const listByChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access) return []

    const now = Date.now()
    const rows = await ctx.db
      .query('typingStatus')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .collect()

    const out: Array<{ userId: string; name: string }> = []
    for (const row of rows) {
      if (row.userId === user._id) continue
      if (now - row.updatedAt >= TYPING_TTL_MS) continue
      const member = await ctx.db.get(row.userId)
      if (!member) continue
      // Prefer the per-workspace nickname (server display name) when there is one, so a
      // typing line reads like every other name in the channel — never the raw email/id.
      const membership = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace_user', (q) =>
          q.eq('workspaceId', access.channel.workspaceId).eq('userId', row.userId)
        )
        .unique()
      out.push({ userId: row.userId, name: membership?.displayName ?? member.name ?? 'Someone' })
    }
    return out
  }
})
