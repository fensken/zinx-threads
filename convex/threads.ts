import { ConvexError, v } from 'convex/values'
import { query, mutation, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import {
  getChannelAccess,
  getCurrentUser,
  getMembership,
  requireChannelAccess,
  requireUser
} from './lib/auth'
import { MESSAGE_PAGE, enrichMessages, resolveAuthors } from './lib/messages'
import { getMyChannelIds } from './lib/channelMembers'
import { listRealChannels } from './lib/channels'
import { internal } from './_generated/api'

/** Threads shown in the workspace-wide flyout / per channel. */
const THREAD_PAGE = 50

/** How far `countsByChannel` scans to build the sidebar's per-channel badges. */
const THREAD_COUNT_SCAN = 500

const MAX_NAME = 80

/** Start a thread from a channel message (any member — Discord/Slack both let
 *  anyone branch a conversation). The root message stays in the channel and gains
 *  a `threadRootId`; replies go in via `messages.send({ threadId })`. */
export const create = mutation({
  args: { messageId: v.id('messages'), name: v.string() },
  handler: async (ctx, { messageId, name }) => {
    const user = await requireUser(ctx)
    const message = await ctx.db.get(messageId)
    if (!message) throw new ConvexError('Message not found')
    // Any member with access can branch a thread — including guests of a shared channel.
    const access = await requireChannelAccess(ctx, message.channelId, user._id)
    const { channel } = access
    // …but not someone who can only READ here. A thread they can't reply in is a room with
    // no door: `messages.send` would refuse every reply, including their own first one.
    if (!access.canPost) {
      throw new ConvexError("You don't have permission to post in this channel")
    }
    // Not in a DM. `threads` is queried workspace-wide (the header dialog, the ⌘K
    // palette, the sidebar's count badges) and those queries gate on workspace
    // membership — so a thread inside a DM would put its name and its root message
    // in front of the whole workspace. The UI hides the affordance; this is the
    // guarantee behind it.
    if (channel.kind === 'dm') {
      throw new ConvexError("You can't start a thread in a direct message")
    }
    if (message.threadRootId) throw new ConvexError('This message already has a thread')
    if (message.threadId) throw new ConvexError("You can't start a thread inside a thread")

    const trimmed = name.trim().slice(0, MAX_NAME)
    if (!trimmed) throw new ConvexError('Give the thread a name')

    const now = Date.now()
    const threadId = await ctx.db.insert('threads', {
      workspaceId: message.workspaceId,
      channelId: message.channelId,
      rootMessageId: messageId,
      name: trimmed,
      createdBy: user._id,
      createdAt: now,
      replyCount: 0,
      // No replies yet — sorting by "last activity" should still place a brand
      // new thread at the top of the flyout.
      lastReplyAt: now,
      participantIds: [message.authorId]
    })
    await ctx.db.patch(messageId, { threadRootId: threadId })
    return threadId
  }
})

/** Every thread in the workspace, most recently active first. Backs the header
 *  and sidebar "Threads" flyouts. Null-safe: [] if not a member. */
export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership) return []

    // A thread's NAME is a preview of its root message — so listing threads from a private
    // channel leaks the content, not merely the existence, of a room the caller was kept
    // out of. Drop them before anything is enriched or returned.
    const visible = await visibleChannelFilter(ctx, workspaceId, user._id, membership.role)
    const threads = (
      await ctx.db
        .query('threads')
        .withIndex('by_workspace_last_reply', (q) => q.eq('workspaceId', workspaceId))
        .order('desc')
        .take(THREAD_PAGE)
    ).filter((thread) => visible(thread.channelId))

    const roots = await Promise.all(threads.map((thread) => ctx.db.get(thread.rootMessageId)))
    const channels = await Promise.all(threads.map((thread) => ctx.db.get(thread.channelId)))
    const authors = await resolveAuthors(
      ctx,
      workspaceId,
      roots.flatMap((root) => (root ? [root.authorId] : []))
    )

    return threads.map((thread, index) => {
      const root = roots[index]
      const author = root ? authors.get(root.authorId) : null
      return {
        _id: thread._id,
        name: thread.name,
        channelId: thread.channelId,
        channelName: channels[index]?.name ?? 'unknown',
        replyCount: thread.replyCount,
        lastReplyAt: thread.lastReplyAt,
        rootBody: root?.body ?? '',
        rootAuthorName: author?.name ?? 'Unknown',
        rootAuthorColor: author?.color,
        rootAuthorAvatarUrl: author?.avatarUrl
      }
    })
  }
})

/** How many threads each channel has — the sidebar's `ChatsCircle` count badge.
 *  The sidebar does NOT list threads (the channel header's dialog does); it just
 *  says how many are there, so this returns counts, not rows.
 *
 *  One workspace-wide subscription grouped client-side, not one query per channel
 *  row: the sidebar renders every channel at once, so per-channel queries would be
 *  a fan-out of subscriptions that all invalidate together. Bounded by
 *  `THREAD_COUNT_SCAN` — past that the badges under-count rather than the query
 *  scanning an unbounded table. */
export const countsByChannel = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership) return []

    // Even a COUNT leaks: a badge on a channel row you can't open tells you a private
    // conversation is happening. (The sidebar wouldn't render the row anyway, but the query
    // must not be the thing relied on for that.)
    const visible = await visibleChannelFilter(ctx, workspaceId, user._id, membership.role)
    const threads = (
      await ctx.db
        .query('threads')
        .withIndex('by_workspace_last_reply', (q) => q.eq('workspaceId', workspaceId))
        .order('desc')
        .take(THREAD_COUNT_SCAN)
    ).filter((thread) => visible(thread.channelId))

    const counts = new Map<string, number>()
    for (const thread of threads) {
      counts.set(thread.channelId, (counts.get(thread.channelId) ?? 0) + 1)
    }
    return [...counts].map(([channelId, count]) => ({
      channelId: channelId as Id<'channels'>,
      count
    }))
  }
})

/** One thread + its (enriched) root message — the panel header and the message
 *  above the "N replies" divider. `null` if missing or not a member. */
export const get = query({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null
    const thread = await ctx.db.get(threadId)
    if (!thread) return null
    const access = await getChannelAccess(ctx, thread.channelId, user._id)
    if (!access) return null
    const isModerator = access.canModerate

    const root = await ctx.db.get(thread.rootMessageId)
    if (!root) return null
    const channel = await ctx.db.get(thread.channelId)

    const [enrichedRoot] = await enrichMessages(ctx, {
      messages: [root],
      workspaceId: thread.workspaceId,
      viewer: user,
      isModerator
    })

    return {
      ...thread,
      channelName: channel?.name ?? 'unknown',
      channelKind: channel?.kind ?? 'chat',
      root: enrichedRoot,
      /** Rename/delete **the thread**: its creator, or a moderator. */
      canManage: isModerator || thread.createdBy === user._id,
      /** Pin / delete **anyone's message**: owner or admin only. Distinct from
       *  `canManage` — a plain member who started a thread doesn't get to
       *  moderate the replies inside it. */
      canModerate: isModerator,
      /** May the reader REPLY? A thread inherits its channel's posting policy — a
       *  read-only channel is read-only all the way down, or a thread would be the
       *  hole in it. `messages.send` gates on the same value. */
      canPost: access.canPost,
      postingPolicy: channel?.postingPolicy
    }
  }
})

/** A thread's replies, oldest→newest, enriched exactly like channel messages. */
export const listMessages = query({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const thread = await ctx.db.get(threadId)
    if (!thread) return []
    const access = await getChannelAccess(ctx, thread.channelId, user._id)
    if (!access) return []
    const isModerator = access.canModerate

    const recent = await ctx.db
      .query('messages')
      .withIndex('by_thread_created', (q) => q.eq('threadId', threadId))
      .order('desc')
      .take(MESSAGE_PAGE)

    return await enrichMessages(ctx, {
      messages: recent.reverse(),
      workspaceId: thread.workspaceId,
      viewer: user,
      isModerator
    })
  }
})

/** Rename — the thread's creator or a workspace owner/admin. */
export const rename = mutation({
  args: { threadId: v.id('threads'), name: v.string() },
  handler: async (ctx, { threadId, name }) => {
    const { thread } = await requireManage(ctx, threadId)
    const trimmed = name.trim().slice(0, MAX_NAME)
    if (!trimmed) throw new ConvexError('Give the thread a name')
    await ctx.db.patch(thread._id, { name: trimmed })
  }
})

/** Delete a thread and every reply in it (hard delete, like `messages.remove`).
 *  The root message survives — it's a channel message — and loses its indicator.
 *
 *  Known debt, same as `workspaces.remove` / `channels.remove`: the cascade
 *  `.collect()`s the replies. Fine at the `MESSAGE_PAGE`-ish scale a thread
 *  reaches; should become a paginated/batched delete. */
export const remove = mutation({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const { thread } = await requireManage(ctx, threadId)

    // Un-root the channel message + delete the thread row now (the indicator and
    // panel clear immediately); its replies drain in bounded batches via
    // `cleanup.thread`.
    const root = await ctx.db.get(thread.rootMessageId)
    if (root) await ctx.db.patch(root._id, { threadRootId: undefined })
    await ctx.db.delete(threadId)
    await ctx.scheduler.runAfter(0, internal.cleanup.thread, { threadId })
  }
})

/** Rename/delete is gated to the thread's **creator** or a workspace owner/admin
 *  — the same shape as `messages.remove`'s "author or moderator". */
async function requireManage(
  ctx: MutationCtx,
  threadId: Id<'threads'>
): Promise<{ thread: Doc<'threads'> }> {
  const user = await requireUser(ctx)
  const thread = await ctx.db.get(threadId)
  if (!thread) throw new ConvexError('Thread not found')
  // Host-workspace owner/admin, or the thread's creator (a guest may manage a
  // thread they started in a shared channel).
  const access = await requireChannelAccess(ctx, thread.channelId, user._id)
  if (!access.canModerate && thread.createdBy !== user._id) {
    throw new ConvexError("You don't have permission to manage this thread")
  }
  return { thread }
}

/**
 * "Can this caller see channel X?" — resolved once, for the workspace-wide thread queries.
 *
 * Both of them enumerate threads across every channel, so both must drop the ones in
 * private channels the caller isn't in. This reads the caller's channel memberships once
 * and the private-channel set once, then answers from memory.
 */
async function visibleChannelFilter(
  ctx: QueryCtx,
  workspaceId: Id<'workspaces'>,
  userId: Id<'users'>,
  role: Doc<'workspaceMembers'>['role']
): Promise<(channelId: Id<'channels'>) => boolean> {
  const mine = await getMyChannelIds(ctx, workspaceId, userId)
  // Only PRIVATE channels need a membership check — but a guest needs one for every
  // channel, so for them the "restricted" set is everything.
  const restricted = new Set<string>()
  // `listRealChannels` (one range per real kind) instead of a `by_workspace` + `.collect()`
  // scan, which also reads every DM row in the workspace — thousands at scale — to throw
  // them away. Threads never live in a DM, so DMs are irrelevant here anyway.
  const channels = await listRealChannels(ctx, workspaceId)
  for (const channel of channels) {
    if (role === 'guest' || channel.visibility === 'private') {
      restricted.add(channel._id as string)
    }
  }
  return (channelId) => {
    const key = channelId as string
    return !restricted.has(key) || mine.has(key)
  }
}
