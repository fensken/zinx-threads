import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { r2, reclaimAttachments } from './files'
import { MAX_TIMERS_PER_USER, MIN_AUTOLOG_MS, computeElapsed } from './lib/timesheet'

/** At most one timer per member on a given task, so a task's timers are bounded by the
 *  workspace's member count in the worst case — take the same cap as a person's own list. */
const MAX_TIMERS_PER_TASK = MAX_TIMERS_PER_USER * 10

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
  await reclaimAttachments(ctx, message.attachments)
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

    // Running timers on this board — the board is gone, so there is nothing left to time.
    const timers = await ctx.db
      .query('timerStates')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of timers) await ctx.db.delete(row._id)
    if (timers.length === BATCH) more = true

    const totals = await ctx.db
      .query('taskTimeTotals')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of totals) await ctx.db.delete(row._id)
    if (totals.length === BATCH) more = true

    // The board's time entries + their audit trail.
    //
    // These are DELETED, not orphaned, and the reason is worth stating: the timesheet is a
    // view of this kanban channel, so an entry whose channel is gone can never be displayed
    // again. Keeping it would preserve rows in the database that no longer exist as far as
    // anyone using the app is concerned — the worst of both options. Deleting a channel
    // already destroys its messages and its board; its hours go the same way, and
    // the delete confirmation says so.
    //
    // (A task deletion is different and deliberately preserves its hours: the board is still
    // there to show them. See `cleanup.taskTime`.)
    const entries = await ctx.db
      .query('timesheetEntries')
      .withIndex('by_channel_started', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of entries) {
      const audit = await ctx.db
        .query('timesheetEntryEdits')
        .withIndex('by_entry', (q) => q.eq('entryId', row._id))
        .collect()
      for (const edit of audit) await ctx.db.delete(edit._id)
      await ctx.db.delete(row._id)
    }
    if (entries.length === BATCH) more = true

    // Database channel: its records can be many, so batch them like messages.
    const dbRecords = await ctx.db
      .query('databaseRecords')
      .withIndex('by_channel_order', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of dbRecords) await ctx.db.delete(row._id)
    if (dbRecords.length === BATCH) more = true

    // Form responses — likewise unbounded, batch them.
    const formResponses = await ctx.db
      .query('formResponses')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(BATCH)
    for (const row of formResponses) await ctx.db.delete(row._id)
    if (formResponses.length === BATCH) more = true

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

      // The whiteboard canvas — one row per channel.
      const whiteboard = await ctx.db
        .query('whiteboards')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .unique()
      if (whiteboard) await ctx.db.delete(whiteboard._id)

      // The doc document — one row per channel, plus its uploaded cover object. Media
      // *inside* the document (images/video/files) is left to `sweepOrphanUploads`: the
      // keys are embedded in the ProseMirror JSON, and parsing a document here to reclaim
      // them would put an editor-version-dependent walk in a cascade that must never fail.
      const doc = await ctx.db
        .query('channelDocs')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .unique()
      if (doc) {
        if (doc.coverKey) {
          try {
            await r2.deleteObject(ctx, doc.coverKey)
          } catch {
            // A stale object is wasted storage, never a failed cascade.
          }
        }
        await ctx.db.delete(doc._id)
      }

      // Ephemeral typing rows — self-expiring and few, but drop them with the channel
      // so nothing lingers.
      const typing = await ctx.db
        .query('typingStatus')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .collect()
      for (const row of typing) await ctx.db.delete(row._id)

      // Database channel schema — fields + views (bounded sets; records drained above).
      const dbFields = await ctx.db
        .query('databaseFields')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .collect()
      for (const row of dbFields) await ctx.db.delete(row._id)
      const dbViews = await ctx.db
        .query('databaseViews')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .collect()
      for (const row of dbViews) await ctx.db.delete(row._id)

      // Form channel — one row (responses drained above), plus its response counter.
      const form = await ctx.db
        .query('forms')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .unique()
      if (form) {
        const stats = await ctx.db
          .query('formStats')
          .withIndex('by_form', (q) => q.eq('formId', form._id))
          .unique()
        if (stats) await ctx.db.delete(stats._id)
        await ctx.db.delete(form._id)
      }

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

    // Losing access to a private board has to stop the clock on it — otherwise the timer
    // keeps running against a task they can no longer open. Their logged hours stay.
    // A JS filter over ≤20 rows, so this needs no extra index.
    const timers = await ctx.db
      .query('timerStates')
      .withIndex('by_workspace_user', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
      .take(MAX_TIMERS_PER_USER)
    for (const timer of timers) {
      if (timer.channelId === channelId) await ctx.db.delete(timer._id)
    }

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
/**
 * A deleted task's time state.
 *
 * Its timers and its rollup go; its logged **hours stay**, keyed to the snapshot columns on
 * the entry. Deleting a card is a board-tidying action, not a decision to erase what people
 * worked on — and a teammate tidying up must not silently delete your billable history.
 *
 * A timer that was *running* when the task vanished is auto-logged rather than dropped:
 * silently discarding someone's 40 minutes because a colleague deleted the card is data
 * loss dressed up as a cascade. Below a minute it's noise, so it goes.
 *
 * Bounded without batching: there is at most one timer per member per task, and exactly one
 * totals row.
 */
export const taskTime = internalMutation({
  args: { taskId: v.id('kanbanTasks'), channelId: v.id('channels') },
  handler: async (ctx, { taskId, channelId }) => {
    const now = Date.now()
    const timers = await ctx.db
      .query('timerStates')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .take(MAX_TIMERS_PER_TASK)

    for (const timer of timers) {
      const elapsed = computeElapsed(timer, now)
      if (elapsed >= MIN_AUTOLOG_MS) {
        const task = await ctx.db.get(timer.taskId)
        const channel = await ctx.db.get(channelId)
        const user = await ctx.db.get(timer.userId)
        await ctx.db.insert('timesheetEntries', {
          workspaceId: timer.workspaceId,
          // Keep `channelId` — only the TASK is gone, and the board's timesheet is the one
          // place these hours can be seen. Dropping it would preserve the row in the
          // database and make it unreachable in the product, which is the same as losing
          // it. `taskId` is deliberately absent: that document no longer exists.
          channelId,
          taskTitle: task?.title ?? 'Deleted task',
          channelName: channel?.name ?? 'board',
          userName: user?.name ?? 'Member',
          userId: timer.userId,
          startedAt: Math.max(timer._creationTime, now - elapsed),
          durationMs: elapsed,
          trackedMs: elapsed,
          source: 'timer',
          note: 'Task was deleted while this timer was running'
        })
      }
      await ctx.db.delete(timer._id)
    }

    // The totals row goes with the task — which is why the auto-logged entry above
    // deliberately does not bump it.
    const totals = await ctx.db
      .query('taskTimeTotals')
      .withIndex('by_task', (q) => q.eq('taskId', taskId))
      .unique()
    if (totals) await ctx.db.delete(totals._id)
  }
})

/**
 * A deleted column's tasks, in batches.
 *
 * `boards.removeColumn` used to delete up to 500 tasks inline. Each task now also carries
 * timers and a rollup, so that would blow a mutation's document limit — hence the move to
 * the standard batched shape. The column row is already gone; `by_column_order` still
 * resolves by its id.
 */
export const column = internalMutation({
  args: { columnId: v.id('kanbanColumns'), channelId: v.id('channels') },
  handler: async (ctx, { columnId, channelId }) => {
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_column_order', (q) => q.eq('columnId', columnId))
      .take(BATCH)
    for (const task of tasks) {
      await ctx.db.delete(task._id)
      await ctx.scheduler.runAfter(0, internal.cleanup.taskTime, {
        taskId: task._id,
        channelId
      })
    }
    if (tasks.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.column, { columnId, channelId })
    }
  }
})

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

    // Their running timers stop. Their `timesheetEntries` deliberately STAY — the same rule
    // as their authored messages: the hours were worked, and payroll/billing history can't
    // depend on someone still being in the workspace. `userId` stays resolvable (the `users`
    // row survives leaving) and `userName` covers a hard account deletion.
    const timers = await ctx.db
      .query('timerStates')
      .withIndex('by_workspace_user', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
      .take(BATCH)
    for (const row of timers) await ctx.db.delete(row._id)
    if (timers.length === BATCH) more = true

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

    // The time ledger + its audit trail. This is the ONLY place a `timesheetEntries` row is
    // ever really deleted — every other cascade nulls its FKs and leaves the hours standing.
    // Both grow without bound over a workspace's life, so both are batched.
    const timeEntries = await ctx.db
      .query('timesheetEntries')
      .withIndex('by_workspace_started', (q) => q.eq('workspaceId', workspaceId))
      .take(BATCH)
    for (const row of timeEntries) await ctx.db.delete(row._id)
    if (timeEntries.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.workspace, { workspaceId })
      return
    }

    const timeEdits = await ctx.db
      .query('timesheetEntryEdits')
      .withIndex('by_workspace_at', (q) => q.eq('workspaceId', workspaceId))
      .take(BATCH)
    for (const row of timeEdits) await ctx.db.delete(row._id)
    if (timeEdits.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.workspace, { workspaceId })
      return
    }

    // Any timers that outlived their channel cascade (a workspace with no boards left, or a
    // timer whose channel batch hasn't drained yet). Bounded per pass.
    const staleTimers = await ctx.db
      .query('timerStates')
      .withIndex('by_workspace_user', (q) => q.eq('workspaceId', workspaceId))
      .take(BATCH)
    for (const row of staleTimers) await ctx.db.delete(row._id)
    if (staleTimers.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.workspace, { workspaceId })
      return
    }

    // Audit log — append-only and unbounded over a workspace's life, so batch it like
    // the other growing tables. (A compliance export is expected to have already run
    // before deletion; nothing here preserves it.)
    const audits = await ctx.db
      .query('auditLogs')
      .withIndex('by_workspace_created', (q) => q.eq('workspaceId', workspaceId))
      .take(BATCH)
    for (const row of audits) await ctx.db.delete(row._id)
    if (audits.length === BATCH) {
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
