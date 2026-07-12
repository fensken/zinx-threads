import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { Id } from './_generated/dataModel'
import {
  getChannelAccess,
  getCurrentUser,
  getMembership,
  getSharedChannelsInto,
  requireUser
} from './lib/auth'
import { mentionsUser } from './lib/messages'
import { MENTION_SCAN, markChannelRead } from './lib/unread'
import type { Doc } from './_generated/dataModel'

export interface ChannelUnread {
  channelId: Id<'channels'>
  /** At least one unread message. Discord bolds the row; it shows no count. */
  hasUnread: boolean
  /** Unread messages that ping you — `@you`, `@everyone`, or `@admins` if you are
   *  one. Never your own. This is the number in the red pill. */
  mentionCount: number
  /** We hit the `MENTION_SCAN` cap, so `mentionCount` is a **lower bound** —
   *  render it as `N+`. */
  mentionsOverflow: boolean
}

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
    const isModerator = membership.role !== 'member'

    const owned = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    // Channels shared INTO this workspace are unread here too. The viewer is a guest
    // in them, so `@admins` never pings them (moderator: false); guest reads were
    // stamped with THIS workspace, so the `by_user_workspace` read markers cover them.
    const shared = await getSharedChannelsInto(ctx, workspaceId)
    const items: Array<{ channel: Doc<'channels'>; moderator: boolean }> = [
      ...owned.map((channel) => ({ channel, moderator: isModerator })),
      ...shared.map((channel) => ({ channel, moderator: false }))
    ]

    const reads = await ctx.db
      .query('channelReads')
      .withIndex('by_user_workspace', (q) =>
        q.eq('userId', user._id).eq('workspaceId', workspaceId)
      )
      .collect()
    const readAt = new Map(reads.map((read) => [read.channelId, read.lastReadAt]))

    const out: ChannelUnread[] = []
    for (const { channel, moderator } of items) {
      if (channel.kind !== 'chat') continue
      const lastReadAt = readAt.get(channel._id) ?? 0
      // Provably read (or never had a message) — don't touch `messages` at all.
      if ((channel.lastMessageAt ?? 0) <= lastReadAt) continue

      // Thread replies pinned to `undefined`, exactly as `messages.listByChannel`
      // does — a reply inside a thread doesn't make its channel unread.
      const unread = await ctx.db
        .query('messages')
        .withIndex('by_channel_thread_created', (q) =>
          q.eq('channelId', channel._id).eq('threadId', undefined).gt('createdAt', lastReadAt)
        )
        .take(MENTION_SCAN + 1)

      // `lastMessageAt` is never decremented, so a deleted newest message can send
      // us here with nothing to show. Decide from the rows, not the watermark.
      const fresh = unread.filter((message) => message.authorId !== user._id)
      if (fresh.length === 0) continue

      const mentions = fresh.filter((message) =>
        mentionsUser(message.body, user._id, moderator)
      ).length

      out.push({
        channelId: channel._id,
        hasUnread: true,
        mentionCount: Math.min(mentions, MENTION_SCAN),
        // We stopped at the cap, so there may be mentions we never looked at:
        // the count is a lower bound, not a maybe-wrong number.
        mentionsOverflow: unread.length > MENTION_SCAN
      })
    }
    return out
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
    if (!(await getMembership(ctx, workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    const owned = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    const shared = await getSharedChannelsInto(ctx, workspaceId)
    const now = Date.now()
    for (const channel of [...owned, ...shared]) {
      if (channel.kind !== 'chat') continue
      // Mark up to the newest message, not `now`: a message can arrive between
      // these two patches, and it should stay unread.
      const upTo = channel.lastMessageAt ?? 0
      if (upTo === 0) continue
      // Guest reads (shared channels) stamp THIS workspace, so they clear here.
      await markChannelRead(ctx, user._id, channel, Math.min(upTo, now), workspaceId)
    }
  }
})
