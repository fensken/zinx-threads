import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import {
  getChannelAccess,
  getCurrentUser,
  getMembership,
  getSharedChannelsInto,
  requireUser
} from './lib/auth'
import { listRealChannels } from './lib/channels'
import { getMyChannelIds, visibleChannels } from './lib/channelMembers'
import { watermarks } from './lib/activity'
import { getMyDmChannels } from './lib/dms'
import { computeWorkspaceUnread, markChannelRead, type ChannelUnread } from './lib/unread'
export type { ChannelUnread }

/** Unread state for every chat channel in a workspace, for the current user.
 *
 *  Null-safe (`[]` when signed out or not a member) like every other query here.
 *  Channels with **no** unread are omitted entirely, so the client treats a
 *  missing entry as read.
 *
 *  Cost: `channels` + this user's `channelReads` (both provably small), then a
 *  bounded scan of at most `MENTION_SCAN` messages for each channel that actually
 *  has something unread. `channels.lastMessageAt` is what makes the common case —
 *  everything already read — cost zero message reads. */
export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }): Promise<ChannelUnread[]> => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership) return []
    // The whole computation lives in `computeWorkspaceUnread` so the MCP `list_unread`
    // tool returns the identical, identically-filtered result — see lib/unread.ts.
    return computeWorkspaceUnread(ctx, user, membership, workspaceId)
  }
})

/** Move your read marker in one channel forward.
 *
 *  `upTo` is the `createdAt` of the newest message the client has actually
 *  rendered — not `Date.now()`. A message that lands between the render and this
 *  mutation must stay unread, which is exactly the race a server-side `now()`
 *  would lose. Clamped to `now` so a bad client can't mark the future read. */
export const markRead = mutation({
  args: { channelId: v.id('channels'), upTo: v.optional(v.number()) },
  handler: async (ctx, { channelId, upTo }) => {
    const user = await requireUser(ctx)
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access) return
    const now = Date.now()
    // Stamp the reader's ACCESS workspace so unread clears in the sidebar they see it in.
    await markChannelRead(
      ctx,
      user._id,
      access.channel,
      Math.min(upTo ?? now, now),
      access.accessWorkspaceId
    )
  }
})

/** Clear every unread channel in a workspace (Discord's "Mark as read" on the
 *  server, Escape on the channel list). Bounded by the channel count. */
export const markAllRead = mutation({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await requireUser(ctx)
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership) {
      throw new ConvexError('Not a member of this workspace')
    }
    const owned = visibleChannels(
      await listRealChannels(ctx, workspaceId),
      membership.role,
      await getMyChannelIds(ctx, workspaceId, user._id)
    )
    const shared = await getSharedChannelsInto(ctx, workspaceId)
    // "Mark all as read" means all of it — your DMs too, as in Slack and Discord.
    const dms = await getMyDmChannels(ctx, workspaceId, user._id)
    const channels = [...owned, ...shared, ...dms]
    const lastMessageAt = await watermarks(ctx, channels)
    const now = Date.now()
    for (const channel of channels) {
      if (channel.kind !== 'chat' && channel.kind !== 'dm') continue
      // Mark up to the newest message, not `now`: a message can arrive between
      // these two patches, and it should stay unread.
      const upTo = lastMessageAt.get(channel._id) ?? 0
      if (upTo === 0) continue
      // Guest reads (shared channels) stamp THIS workspace, so they clear here.
      await markChannelRead(ctx, user._id, channel, Math.min(upTo, now), workspaceId)
    }
  }
})
