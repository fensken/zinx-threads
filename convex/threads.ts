import { ConvexError, v } from 'convex/values'
import { query, mutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import {
  getChannelAccess,
  getCurrentUser,
  getMembership,
  requireChannelAccess,
  requireUser
} from './lib/auth'
import { MESSAGE_PAGE, enrichMessages, resolveAuthors } from './lib/messages'
import { internal } from './_generated/api'

/** Threads shown in the workspace-wide flyout / per channel. */
const THREAD_PAGE = 50

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
    await requireChannelAccess(ctx, message.channelId, user._id)
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
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const threads = await ctx.db
      .query('threads')
      .withIndex('by_workspace_last_reply', (q) => q.eq('workspaceId', workspaceId))
      .order('desc')
      .take(THREAD_PAGE)

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

/** Every thread in the workspace, grouped by channel — the sidebar nests a
 *  channel's threads underneath it (and badges a count when it's collapsed),
 *  exactly as the demo sidebar's `ThreadTree` does.
 *
 *  One workspace-wide query rather than one per channel: the sidebar renders
 *  every channel at once, so per-channel queries would be a fan-out of
 *  subscriptions that all change together. */
export const listByChannelForSidebar = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const threads = await ctx.db
      .query('threads')
      .withIndex('by_workspace_last_reply', (q) => q.eq('workspaceId', workspaceId))
      .order('desc')
      .take(THREAD_PAGE)

    return threads.map((thread) => ({
      _id: thread._id,
      name: thread.name,
      channelId: thread.channelId,
      replyCount: thread.replyCount
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
      canModerate: isModerator
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
