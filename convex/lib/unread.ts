import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { getSharedChannelsInto } from './auth'
import { mentionsUser } from './messages'
import { listRealChannels } from './channels'
import { getMyChannelIds, visibleChannels } from './channelMembers'
import { watermarks } from './activity'
import { getMyDmChannels } from './dms'

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

/**
 * Unread state for every chat channel + DM in a workspace, for one user — the single
 * definition, shared by the public `unread.listByWorkspace` query and the MCP `list_unread`
 * tool. The caller passes their OWN `user` + `membership`; the MCP path resolves them from
 * the token, never a JWT, so the same visibility filtering (`visibleChannels`, DMs via
 * `dmMembers`) protects both.
 *
 * Channels with no unread are omitted; a missing entry means "read".
 */
export async function computeWorkspaceUnread(
  ctx: QueryCtx,
  user: Doc<'users'>,
  membership: Doc<'workspaceMembers'>,
  workspaceId: Id<'workspaces'>
): Promise<ChannelUnread[]> {
  // NOT `role !== 'member'` — that predates the `guest` rung and would have made every
  // guest a moderator, so `@admins` would have pinged them.
  const isModerator = membership.role === 'owner' || membership.role === 'admin'

  const myChannelIds = await getMyChannelIds(ctx, workspaceId, user._id)
  const owned = visibleChannels(
    await listRealChannels(ctx, workspaceId),
    membership.role,
    myChannelIds
  )
  const shared = await getSharedChannelsInto(ctx, workspaceId)
  const dms = await getMyDmChannels(ctx, workspaceId, user._id)
  const items: Array<{ channel: Doc<'channels'>; moderator: boolean }> = [
    ...owned.map((channel) => ({ channel, moderator: isModerator })),
    ...shared.map((channel) => ({ channel, moderator: false })),
    ...dms.map((channel) => ({ channel, moderator: false }))
  ]

  const reads = await ctx.db
    .query('channelReads')
    .withIndex('by_user_workspace', (q) => q.eq('userId', user._id).eq('workspaceId', workspaceId))
    .collect()
  const readAt = new Map(reads.map((read) => [read.channelId, read.lastReadAt]))
  const lastMessageAt = await watermarks(
    ctx,
    items.map((item) => item.channel)
  )

  const out: ChannelUnread[] = []
  for (const { channel, moderator } of items) {
    const isDm = channel.kind === 'dm'
    if (channel.kind !== 'chat' && !isDm) continue
    const lastReadAt = readAt.get(channel._id) ?? 0
    if ((lastMessageAt.get(channel._id) ?? 0) <= lastReadAt) continue

    const unread = await ctx.db
      .query('messages')
      .withIndex('by_channel_thread_created', (q) =>
        q.eq('channelId', channel._id).eq('threadId', undefined).gt('createdAt', lastReadAt)
      )
      .take(MENTION_SCAN + 1)

    const fresh = unread.filter((message) => message.authorId !== user._id)
    if (fresh.length === 0) continue

    // In a DM every message is addressed to you — count messages, not mentions.
    const pings = isDm
      ? fresh.length
      : fresh.filter((message) => mentionsUser(message.body, user._id, moderator)).length

    out.push({
      channelId: channel._id,
      hasUnread: true,
      mentionCount: Math.min(pings, MENTION_SCAN),
      mentionsOverflow: unread.length > MENTION_SCAN
    })
  }
  return out
}

/** How many unread messages we look at per channel when counting mentions.
 *
 *  Real clients denormalise a mention counter per (user, channel) at send time.
 *  That trades a bounded read here for a write per mentioned member on every
 *  send — and `@everyone` in a 50-person workspace means 50 patches. At this
 *  scale a bounded scan is simpler and cannot drift, so a channel with more than
 *  this many unread mentions renders as `50+`. Revisit before real scale. */
export const MENTION_SCAN = 50

/** Move a member's read marker forward. Never backwards, and never a no-op write:
 *  patching a row with the value it already has still bumps `_creationTime`-order
 *  reactivity and re-notifies every subscriber of `unread.listByWorkspace` — the
 *  same trap `pages.saveContent` guards against. */
export async function markChannelRead(
  ctx: MutationCtx,
  userId: Id<'users'>,
  channel: Doc<'channels'>,
  upTo: number,
  /** The workspace the reader views the channel THROUGH — the channel's home
   *  workspace for an owner, or the reader's guest workspace for a shared channel
   *  (so `unread.listByWorkspace` finds the marker in the sidebar they see it in).
   *  Defaults to the channel's home workspace. */
  readWorkspaceId?: Id<'workspaces'>
): Promise<void> {
  const existing = await ctx.db
    .query('channelReads')
    .withIndex('by_user_channel', (q) => q.eq('userId', userId).eq('channelId', channel._id))
    .unique()

  if (!existing) {
    await ctx.db.insert('channelReads', {
      userId,
      workspaceId: readWorkspaceId ?? channel.workspaceId,
      channelId: channel._id,
      lastReadAt: upTo
    })
    return
  }
  if (existing.lastReadAt >= upTo) return
  await ctx.db.patch(existing._id, { lastReadAt: upTo })
}
