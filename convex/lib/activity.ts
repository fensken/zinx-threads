import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

/**
 * A channel's "newest message" watermark — the thing unread state compares against.
 *
 * **It deliberately does not live on the channel document.** It used to, and that made
 * `channels` a *hot* table: `messages.send` patched the channel row on every single
 * message, and Convex invalidates a subscription when any document it read changes. The
 * channel documents are read by `channels.listBySlug` (the sidebar), `resolveBySlug`
 * (the route), the workspace directory (mentions + profile cards), the ⌘K palette, the
 * threads flyout and the DM list — **six always-mounted subscriptions, on every
 * connected client**. So one person typing in one channel re-ran all six queries for
 * every member of the workspace, none of which display a watermark at all.
 *
 * Splitting it into its own row means the channel document is effectively immutable
 * during normal use (it changes on rename/move, which is what those queries actually
 * care about). Only the queries that genuinely track activity — unread and the DM list
 * — read `channelActivity`, so only they re-run when a message lands. That is the
 * whole point: the fan-out of an invalidation should match the fan-out of the data.
 *
 * Channels written before this table exists have no row; `watermarkOf` falls back to
 * the legacy `channels.lastMessageAt` field, so no backfill is needed and no channel
 * silently reads as fully-read. Nothing writes that field any more.
 */

/** Move a channel's watermark forward. Never backwards — a deleted newest message
 *  leaves it stale-high, which costs one bounded scan that finds nothing, never a
 *  wrong answer (the same trade the field always made). */
export async function bumpChannelActivity(
  ctx: MutationCtx,
  channel: Doc<'channels'>,
  at: number
): Promise<void> {
  const existing = await ctx.db
    .query('channelActivity')
    .withIndex('by_channel', (q) => q.eq('channelId', channel._id))
    .unique()
  if (!existing) {
    await ctx.db.insert('channelActivity', {
      channelId: channel._id,
      workspaceId: channel.workspaceId,
      lastMessageAt: at
    })
    return
  }
  // Never a no-op patch: re-writing the same value still re-notifies every
  // subscriber (the same trap `pages.saveContent` and `markChannelRead` guard).
  if (existing.lastMessageAt >= at) return
  await ctx.db.patch(existing._id, { lastMessageAt: at })
}

/** Watermarks for a set of channels, keyed by channel id. The channels may span
 *  workspaces (a guest's shared channels, a member's DMs), so this reads one row per
 *  channel rather than a workspace range. */
export async function watermarks(
  ctx: QueryCtx,
  channels: Doc<'channels'>[]
): Promise<Map<Id<'channels'>, number>> {
  const rows = await Promise.all(
    channels.map((channel) =>
      ctx.db
        .query('channelActivity')
        .withIndex('by_channel', (q) => q.eq('channelId', channel._id))
        .unique()
    )
  )
  return new Map(
    channels.map((channel, index) => [
      channel._id,
      // Legacy fallback for channels last written before this table existed.
      rows[index]?.lastMessageAt ?? channel.lastMessageAt ?? 0
    ])
  )
}
