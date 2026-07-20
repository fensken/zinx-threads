import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { reclaimAttachments } from './files'
import { removeNotificationsForMessage } from './lib/notifications'
import { removeThreadReply } from './lib/threads'
import type { Doc } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

/**
 * Enterprise **message-retention** enforcement. A workspace's `messageRetentionDays`
 * (set by an owner/admin in Settings → Compliance) means "we do not keep channel
 * messages older than this" — the compliance control that lets a regulated team adopt
 * the app at all. A daily cron sweeps every workspace with a policy and hard-deletes
 * anything past the cutoff, reusing the SAME cascade a manual delete does (reactions,
 * R2 attachments, notifications, and — for a thread root — the whole thread).
 *
 * DMs are exempt: they're personal, and a workspace retention policy is about the
 * team's channels, not people's private conversations (Slack draws the same line).
 *
 * Everything is batched + self-rescheduling — a workspace with millions of old
 * messages must not try to delete them in one mutation.
 */

const WS_PAGE = 25 // workspaces scanned per cron tick
const MSG_BATCH = 50 // messages purged per channel tick
const DAY_MS = 86_400_000

/** Full-cascade delete of one message — the retention twin of `messages.remove`,
 *  minus the auth (the cron is the actor). Kept in step with that mutation. */
async function purgeMessageFully(ctx: MutationCtx, message: Doc<'messages'>): Promise<void> {
  // A thread root takes its whole thread with it.
  if (message.threadRootId) {
    await ctx.db.delete(message.threadRootId)
    await ctx.scheduler.runAfter(0, internal.cleanup.thread, { threadId: message.threadRootId })
  }
  const reactions = await ctx.db
    .query('messageReactions')
    .withIndex('by_message', (q) => q.eq('messageId', message._id))
    .collect()
  for (const reaction of reactions) await ctx.db.delete(reaction._id)
  await removeNotificationsForMessage(ctx, message._id)
  await reclaimAttachments(ctx, message.attachments)
  await ctx.db.delete(message._id)
  if (message.threadId) await removeThreadReply(ctx, message.threadId)
}

/** The cron entry point: page through workspaces and fan out a per-workspace sweep for
 *  each one that has a retention policy. */
export const enforce = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('workspaces').paginate({
      numItems: WS_PAGE,
      cursor: cursor ?? null
    })
    const now = Date.now()
    for (const workspace of page.page) {
      const days = workspace.messageRetentionDays
      if (days && days > 0) {
        await ctx.scheduler.runAfter(0, internal.retention.sweepWorkspace, {
          workspaceId: workspace._id,
          cutoff: now - days * DAY_MS,
          channelCursor: null
        })
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.retention.enforce, { cursor: page.continueCursor })
    }
  }
})

/** Sweep one workspace: page through its channels, sweeping old messages in each. */
export const sweepWorkspace = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    cutoff: v.number(),
    channelCursor: v.union(v.string(), v.null())
  },
  handler: async (ctx, { workspaceId, cutoff, channelCursor }) => {
    const page = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .paginate({ numItems: WS_PAGE, cursor: channelCursor })
    for (const channel of page.page) {
      // DMs are exempt from a workspace retention policy.
      if (channel.kind === 'dm') continue
      await ctx.scheduler.runAfter(0, internal.retention.sweepChannel, {
        channelId: channel._id,
        cutoff
      })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.retention.sweepWorkspace, {
        workspaceId,
        cutoff,
        channelCursor: page.continueCursor
      })
    }
  }
})

/** Purge one channel's messages older than `cutoff`, in batches. Reads the OLDEST
 *  channel messages first (`by_channel_thread_created`, `threadId: undefined`, ascending)
 *  — so the batch is exactly the expired head of the channel, and we stop as soon as we
 *  reach a message newer than the cutoff. Thread replies drain with their root above. */
export const sweepChannel = internalMutation({
  args: { channelId: v.id('channels'), cutoff: v.number() },
  handler: async (ctx, { channelId, cutoff }) => {
    const oldest = await ctx.db
      .query('messages')
      .withIndex('by_channel_thread_created', (q) =>
        q.eq('channelId', channelId).eq('threadId', undefined).lt('createdAt', cutoff)
      )
      .order('asc')
      .take(MSG_BATCH)

    for (const message of oldest) await purgeMessageFully(ctx, message)

    // A full batch means there may be more expired messages — reschedule.
    if (oldest.length === MSG_BATCH) {
      await ctx.scheduler.runAfter(0, internal.retention.sweepChannel, { channelId, cutoff })
    }
  }
})
