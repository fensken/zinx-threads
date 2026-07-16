import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { r2 } from './files'

// Background cascade deletes. The public `remove` mutations (channels/workspaces/
// threads) delete the top row immediately — so it vanishes from the UI — then
// schedule one of these to drain the children in **bounded batches**, rescheduling
// itself until nothing is left. Doing it inline `.collect()`-ed everything into one
// mutation, which past enough messages+reactions exceeds Convex's per-mutation
// document limit and fails the delete *every* time. (Was the accepted debt behind
// task #41.)

/** Rows touched per run. Small enough that a batch (with its per-message reaction
 *  fan-out + best-effort R2 deletes) stays well under a mutation's limits. */
const BATCH = 50

/** Delete a message's reactions + attachment objects, then the message. Reactions
 *  are capped per message, so their `.collect()` is bounded. */
async function purgeMessage(ctx: MutationCtx, message: Doc<'messages'>): Promise<void> {
  const reactions = await ctx.db
    .query('messageReactions')
    .withIndex('by_message', (q) => q.eq('messageId', message._id))
    .collect()
  for (const reaction of reactions) await ctx.db.delete(reaction._id)
  for (const attachment of message.attachments ?? []) {
    try {
      await r2.deleteObject(ctx, attachment.key)
    } catch {
      // orphaned object, not a failure
    }
  }
  await ctx.db.delete(message._id)
}

/** Drain everything hanging off a channel, in batches. The channel row itself is
 *  already gone (deleted by `channels.remove`), but the child indexes still resolve
 *  by `channelId`. */
export const channel = internalMutation({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    let more = false

    // These three use the CHANNEL PREFIX of a compound index (`by_channel_thread_created`
    // / `by_channel_workspace`) rather than a dedicated `by_channel` — the single-field
    // index was dropped to save an index write on every message / notification / read
    // (the three hottest write tables). Deletion doesn't care about the sort order the
    // rest of the compound key imposes.
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_channel_thread_created', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const message of messages) await purgeMessage(ctx, message)
    if (messages.length === BATCH) more = true

    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_channel_workspace', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of notifications) await ctx.db.delete(row._id)
    if (notifications.length === BATCH) more = true

    const threads = await ctx.db
      .query('threads')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of threads) await ctx.db.delete(row._id)
    if (threads.length === BATCH) more = true

    const reads = await ctx.db
      .query('channelReads')
      .withIndex('by_channel_workspace', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of reads) await ctx.db.delete(row._id)
    if (reads.length === BATCH) more = true

    const presence = await ctx.db
      .query('voicePresence')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of presence) await ctx.db.delete(row._id)
    if (presence.length === BATCH) more = true

    // A DM's membership. Reached only via the workspace cascade (a DM has no delete
    // of its own), but it's a child of the channel, so it drains with the channel.
    const dmMembers = await ctx.db
      .query('dmMembers')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of dmMembers) await ctx.db.delete(row._id)
    if (dmMembers.length === BATCH) more = true

    // A private channel's membership — same shape, same reason.
    const channelMembers = await ctx.db
      .query('channelMembers')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of channelMembers) await ctx.db.delete(row._id)
    if (channelMembers.length === BATCH) more = true

    // Incoming webhooks that post into this channel — dead once it's gone.
    const webhooks = await ctx.db
      .query('incomingWebhooks')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of webhooks) await ctx.db.delete(row._id)
    if (webhooks.length === BATCH) more = true

    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of tasks) await ctx.db.delete(row._id)
    if (tasks.length === BATCH) more = true

    // Small, bounded sets — drain them once the big ones are done so we don't keep
    // re-reading them every batch.
    if (!more) {
      // The newest-message watermark (`lib/activity.ts`) — one row, and it outlives
      // the channel if nothing deletes it.
      const activity = await ctx.db
        .query('channelActivity')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .unique()
      if (activity) await ctx.db.delete(activity._id)

      const columns = await ctx.db
        .query('kanbanColumns')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .collect()
      for (const row of columns) await ctx.db.delete(row._id)

      const page = await ctx.db
        .query('pages')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .unique()
      if (page) {
        if (page.coverKey) {
          try {
            await r2.deleteObject(ctx, page.coverKey)
          } catch {
            // ignore
          }
        }
        await ctx.db.delete(page._id)
      }

      // The whiteboard canvas — one row, like the page.
      const whiteboard = await ctx.db
        .query('whiteboards')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .unique()
      if (whiteboard) await ctx.db.delete(whiteboard._id)

      // Cross-workspace shares of this channel (bounded by MAX_SHARE_GUESTS) — the
      // guests lose access with the channel. Their per-channel reads/notifications
      // are tagged with the OWNER workspace here (deleted above), so no extra sweep.
      const shares = await ctx.db
        .query('channelShares')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .collect()
      for (const share of shares) await ctx.db.delete(share._id)
    }

    if (more) await ctx.scheduler.runAfter(0, internal.cleanup.channel, { channelId })
  }
})

/**
 * One PERSON left (or was removed from) one channel: drop their read marker and their
 * inbox notifications for it.
 *
 * Not cosmetic. Without it, someone removed from a private channel keeps receiving inbox
 * rows for messages they can no longer read, and clicking one lands on a dead end — a
 * notification that leaks the *existence* of a conversation they've been shut out of.
 *
 * The channel and its messages stay: they belong to the channel, not to the person.
 */
export const channelMember = internalMutation({
  args: {
    channelId: v.id('channels'),
    userId: v.id('users'),
    workspaceId: v.id('workspaces')
  },
  handler: async (ctx, { channelId, userId, workspaceId }) => {
    // One row at most (unique per user+channel), so no batching needed here.
    const read = await ctx.db
      .query('channelReads')
      .withIndex('by_user_channel', (q) => q.eq('userId', userId).eq('channelId', channelId))
      .unique()
    if (read) await ctx.db.delete(read._id)

    // Notifications CAN be many — batch, and reschedule while a batch stays full.
    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user_channel', (q) => q.eq('userId', userId).eq('channelId', channelId))
      .take(BATCH)
    for (const row of notifications) await ctx.db.delete(row._id)

    if (notifications.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.channelMember, {
        channelId,
        userId,
        workspaceId
      })
    }
  }
})

/** A guest workspace left (or was removed from) a shared channel: drop that
 *  workspace's per-channel read markers + inbox notifications for the channel. The
 *  channel + its messages stay (they belong to the host). Bounded batches. */
export const sharedChannelGuest = internalMutation({
  args: { channelId: v.id('channels'), workspaceId: v.id('workspaces') },
  handler: async (ctx, { channelId, workspaceId }) => {
    let more = false

    // The compound indexes return ONLY this guest workspace's rows, so deleting
    // them shrinks the result set each batch (no spin on non-matching rows).
    const reads = await ctx.db
      .query('channelReads')
      .withIndex('by_channel_workspace', (q) =>
        q.eq('channelId', channelId).eq('workspaceId', workspaceId)
      )
      .take(BATCH)
    for (const row of reads) await ctx.db.delete(row._id)
    if (reads.length === BATCH) more = true

    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_channel_workspace', (q) =>
        q.eq('channelId', channelId).eq('workspaceId', workspaceId)
      )
      .take(BATCH)
    for (const row of notifications) await ctx.db.delete(row._id)
    if (notifications.length === BATCH) more = true

    if (more) {
      await ctx.scheduler.runAfter(0, internal.cleanup.sharedChannelGuest, {
        channelId,
        workspaceId
      })
    }
  }
})

/** Drain a thread's replies (and their reactions/attachments/notifications). */
export const thread = internalMutation({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const replies = await ctx.db
      .query('messages')
      .withIndex('by_thread_created', (q) => q.eq('threadId', threadId))
      .take(BATCH)
    for (const reply of replies) {
      const notifications = await ctx.db
        .query('notifications')
        .withIndex('by_message', (q) => q.eq('messageId', reply._id))
        .collect()
      for (const row of notifications) await ctx.db.delete(row._id)
      await purgeMessage(ctx, reply)
    }
    if (replies.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.thread, { threadId })
    }
  }
})

/** Drain a (former) member's per-workspace state when they leave or are removed:
 *  their channel read markers + inbox notifications for that workspace. Their
 *  authored messages stay (Slack/Discord keep a departed member's history). */
export const member = internalMutation({
  args: { workspaceId: v.id('workspaces'), userId: v.id('users') },
  handler: async (ctx, { workspaceId, userId }) => {
    let more = false

    const reads = await ctx.db
      .query('channelReads')
      .withIndex('by_user_workspace', (q) => q.eq('userId', userId).eq('workspaceId', workspaceId))
      .take(BATCH)
    for (const row of reads) await ctx.db.delete(row._id)
    if (reads.length === BATCH) more = true

    const notifications = await ctx.db
      .query('notifications')
      .withIndex('by_user_workspace_created', (q) =>
        q.eq('userId', userId).eq('workspaceId', workspaceId)
      )
      .take(BATCH)
    for (const row of notifications) await ctx.db.delete(row._id)
    if (notifications.length === BATCH) more = true

    // Their private-channel memberships in this workspace. Leaving the workspace takes
    // their access with it — otherwise a removed member's `channelMembers` rows would
    // survive, and re-adding them to the workspace would silently restore access to every
    // private channel they used to be in.
    const channelMemberships = await ctx.db
      .query('channelMembers')
      .withIndex('by_user_workspace', (q) => q.eq('userId', userId).eq('workspaceId', workspaceId))
      .take(BATCH)
    for (const row of channelMemberships) await ctx.db.delete(row._id)
    if (channelMemberships.length === BATCH) more = true

    // Voice presence is one row per user (upsert) — drop it if it's in this workspace.
    const presence = await ctx.db
      .query('voicePresence')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique()
    if (presence && presence.workspaceId === workspaceId) await ctx.db.delete(presence._id)

    if (more) {
      await ctx.scheduler.runAfter(0, internal.cleanup.member, { workspaceId, userId })
    }
  }
})

/** Drain a workspace: its channels (each via `cleanup.channel`), then the small
 *  bounded sets (groups / members / invitations). */
export const workspace = internalMutation({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const channels = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .take(BATCH)
    for (const chan of channels) {
      await ctx.scheduler.runAfter(0, internal.cleanup.channel, { channelId: chan._id })
      await ctx.db.delete(chan._id)
    }
    if (channels.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.workspace, { workspaceId })
      return
    }

    // Channels drained — clean up the workspace-scoped bounded sets.
    const groups = await ctx.db
      .query('channelGroups')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    for (const group of groups) await ctx.db.delete(group._id)

    // Calendar events + their RSVPs. Batched like channels: a long-lived workspace
    // accumulates events without bound, so this must not be one `.collect()`.
    const events = await ctx.db
      .query('events')
      .withIndex('by_workspace_start', (q) => q.eq('workspaceId', workspaceId))
      .take(BATCH)
    for (const event of events) {
      const attendees = await ctx.db
        .query('eventAttendees')
        .withIndex('by_event', (q) => q.eq('eventId', event._id))
        .collect()
      for (const attendee of attendees) await ctx.db.delete(attendee._id)
      await ctx.db.delete(event._id)
    }
    if (events.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.workspace, { workspaceId })
      return
    }

    // Members can be many in a large workspace — batch them like channels above, or a
    // single mutation could exceed its document limit (the exact failure the batching
    // guards against). Each batch also does a per-member `get` for the demo-user check.
    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .take(BATCH)
    for (const member of members) {
      const memberUser = await ctx.db.get(member.userId)
      // A demo or bot principal belongs to this workspace alone, so its `users` row goes with
      // it (a human's row stays — they may be in other workspaces).
      if (memberUser && (memberUser.provider === 'demo' || memberUser.provider === 'bot')) {
        await ctx.db.delete(memberUser._id)
      }
      await ctx.db.delete(member._id)
    }
    if (members.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.workspace, { workspaceId })
      return
    }

    // Bot registry rows + their tokens (their `users` rows + memberships drained above, their
    // webhooks with their channels). Bounded by `MAX_BOTS`.
    const bots = await ctx.db
      .query('bots')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    for (const bot of bots) {
      for (const token of await ctx.db
        .query('apiTokens')
        .withIndex('by_bot', (q) => q.eq('botId', bot._id))
        .collect()) {
        await ctx.db.delete(token._id)
      }
      for (const webhook of await ctx.db
        .query('incomingWebhooks')
        .withIndex('by_bot', (q) => q.eq('botId', bot._id))
        .collect()) {
        await ctx.db.delete(webhook._id)
      }
      await ctx.db.delete(bot._id)
    }

    const invitations = await ctx.db
      .query('workspaceInvitations')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    for (const invitation of invitations) await ctx.db.delete(invitation._id)

    // Shared-channel rows where this workspace is the GUEST of another org's channel
    // (the OWNER-side rows drop with their channels, above). Bounded by how many
    // channels this workspace was a guest of.
    const guestShares = await ctx.db
      .query('channelShares')
      .withIndex('by_guest_workspace', (q) => q.eq('guestWorkspaceId', workspaceId))
      .collect()
    for (const share of guestShares) await ctx.db.delete(share._id)
    // And any owner-side rows whose channel was already gone before this ran.
    const ownerShares = await ctx.db
      .query('channelShares')
      .withIndex('by_owner_workspace', (q) => q.eq('ownerWorkspaceId', workspaceId))
      .collect()
    for (const share of ownerShares) await ctx.db.delete(share._id)
  }
})

/** Retention sweep for the Inbox — the only unboundedly-growing table (a row per
 *  mention/reply/thread, forever; reads are bounded, but storage isn't). Deletes
 *  notifications older than `before` in bounded batches, rescheduling itself until a
 *  run comes back short. Old rows are dropped regardless of read state — a months-old
 *  notification is stale either way, and the message it points at still lives in its
 *  channel. Driven daily by `crons.ts`. */
export const pruneOldNotifications = internalMutation({
  args: { before: v.number() },
  handler: async (ctx, { before }) => {
    const old = await ctx.db
      .query('notifications')
      .withIndex('by_created', (q) => q.lt('createdAt', before))
      .take(BATCH)
    for (const row of old) await ctx.db.delete(row._id)
    if (old.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.pruneOldNotifications, { before })
    }
  }
})

/** How long an Inbox notification is retained (read or unread). */
const NOTIFICATION_TTL_DAYS = 90

/** The cron entry point (no args, so the cutoff is computed at RUN time). Kicks off
 *  the batched prune of notifications older than the TTL. */
export const sweepNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const before = Date.now() - NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000
    await ctx.scheduler.runAfter(0, internal.cleanup.pruneOldNotifications, { before })
  }
})
