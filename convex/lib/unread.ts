import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

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
