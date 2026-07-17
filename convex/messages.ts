import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { internal } from './_generated/api'
import {
  getChannelAccess,
  getCurrentUser,
  getMembership,
  requireChannelAccess,
  requireUser
} from './lib/auth'
import {
  CHANNEL_PAGE,
  CHANNEL_PAGE_MAX,
  MAX_UNIQUE_REACTIONS,
  bodyIsSilent,
  enrichMessages,
  resolveAuthors,
  searchMessagesForUser
} from './lib/messages'
import { addThreadReply, removeThreadReply } from './lib/threads'
import { markChannelRead } from './lib/unread'
import { bumpChannelActivity } from './lib/activity'
import { applyReaction, summarizeReactionRows } from './lib/reactions'
import { fanOutNotifications, removeNotificationsForMessage } from './lib/notifications'
import { markUploadUsed, objectUrl, reclaimAttachments } from './files'
import { rateLimiter } from './rateLimiter'
import type { Doc } from './_generated/dataModel'

/** Files per message. A capped array on the doc (edited as a unit), so bound it. */
const MAX_ATTACHMENTS = 10
/** Per-file ceiling (bytes), mirroring the client's `lib/upload-limits.ts` (50 MB). The
 *  browser PUTs straight to R2, so this is a **reported-size** re-check — the honest client
 *  is already capped; this rejects an oversized `size` from a crafted one (the R2 object, if
 *  it exists, is left unreferenced and the daily sweep reclaims it). */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

/** Messages in a channel, oldest→newest, each enriched with its author's display
 *  fields + grouped reactions. Null-safe: [] if not a member.
 *
 *  **Thread replies are excluded** — they live in their thread, and only the root
 *  message shows in the channel (with a `thread` summary hanging off it). The
 *  `by_channel_thread_created` index pins `threadId` to `undefined` to do that
 *  without a `.filter()`. */
export const listByChannel = query({
  args: {
    channelId: v.id('channels'),
    /** Newest N to load — grows as the client scrolls up (see `CHANNEL_PAGE`). */
    limit: v.optional(v.number())
  },
  handler: async (ctx, { channelId, limit }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    // Access is owner (member of the channel's workspace) OR guest (member of a
    // workspace this channel is shared into). Guests never moderate.
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access) return []
    const { channel, canModerate: isModerator } = access

    // Newest N (clamped), then flip back to chronological order. A guest only sees
    // messages posted after its workspace joined (`access.since`) — the index range
    // enforces the cut-off without a `.filter()`; `since` is 0 for an owner.
    const take = Math.min(Math.max(1, limit ?? CHANNEL_PAGE), CHANNEL_PAGE_MAX)
    const recent = await ctx.db
      .query('messages')
      .withIndex('by_channel_thread_created', (q) =>
        q.eq('channelId', channelId).eq('threadId', undefined).gte('createdAt', access.since)
      )
      .order('desc')
      .take(take)
    const messages = recent.reverse()

    const enriched = await enrichMessages(ctx, {
      messages,
      workspaceId: channel.workspaceId,
      viewer: user,
      isModerator
    })

    // Only the roots in this page can carry a thread, so the fan-out is bounded
    // by the page size rather than by the channel's thread count.
    const threadIds = [
      ...new Set(messages.flatMap((m) => (m.threadRootId ? [m.threadRootId] : [])))
    ]
    const threadDocs = await Promise.all(threadIds.map((id) => ctx.db.get(id)))
    const participantNames = await resolveAuthors(
      ctx,
      channel.workspaceId,
      threadDocs.flatMap((doc) => doc?.participantIds ?? [])
    )
    const threads = new Map(
      threadIds.map((id, index) => {
        const doc = threadDocs[index]
        if (!doc) return [id, null] as const
        return [
          id,
          {
            _id: doc._id,
            name: doc.name,
            replyCount: doc.replyCount,
            lastReplyAt: doc.lastReplyAt,
            participants: doc.participantIds.map((userId) => {
              const author = participantNames.get(userId)
              return {
                name: author?.name ?? 'Unknown',
                color: author?.color,
                avatarUrl: author?.avatarUrl
              }
            })
          }
        ] as const
      })
    )

    return enriched.map((m) => ({
      ...m,
      /** The thread started from this message, if any (drives the indicator). */
      thread: m.threadRootId ? (threads.get(m.threadRootId) ?? null) : null
    }))
  }
})

/** Full-text search over a workspace's channel messages (⌘K palette). Scoped to
 *  the workspace (the caller must be a member); excludes thread replies. Enriched
 *  with the channel name + author so the palette renders without a second pass. */
export const searchInWorkspace = query({
  args: { workspaceId: v.id('workspaces'), term: v.string() },
  handler: async (ctx, { workspaceId, term }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []
    // The whole ranking-then-filtering rule lives in `searchMessagesForUser` so the MCP
    // `search_messages` tool applies the identical visibility check — see lib/messages.ts.
    return searchMessagesForUser(ctx, user, workspaceId, term)
  }
})

/** Pinned messages **in the channel itself**, newest first. Read straight off the
 *  `by_channel_thread_pinned` index rather than scanning the channel.
 *
 *  Thread replies are excluded (`threadId` pinned to `undefined`) — they aren't in
 *  the channel's message list, so a pinned reply here would show a row that
 *  "Jump to message" can never reach. Pinned replies belong to their thread. */
export const listPinned = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access) return []
    const { channel } = access

    const pinnedAll = await ctx.db
      .query('messages')
      .withIndex('by_channel_thread_pinned', (q) =>
        q.eq('channelId', channelId).eq('threadId', undefined).eq('pinned', true)
      )
      .order('desc')
      .take(50)
    // A guest only sees pins from after it joined (this index has no `createdAt`
    // column, so filter the already-fetched, bounded (≤50) result set).
    const pinned = access.since ? pinnedAll.filter((m) => m.createdAt >= access.since) : pinnedAll

    const authors = await resolveAuthors(
      ctx,
      channel.workspaceId,
      pinned.map((m) => m.authorId)
    )
    return pinned.map((m) => ({ ...m, author: authors.get(m.authorId) ?? null }))
  }
})

/** Post a message to a channel as the current user (member-only).
 *
 *  `replyToId` makes it an inline reply (a quote), not a thread. `threadId` posts
 *  it *into* a thread instead of the channel — the two compose, so you can quote
 *  another reply from inside a thread. */
export const send = mutation({
  args: {
    channelId: v.id('channels'),
    body: v.string(),
    replyToId: v.optional(v.id('messages')),
    threadId: v.optional(v.id('threads')),
    /** A client-generated nonce. Pass it and `send` becomes idempotent. */
    clientId: v.optional(v.string()),
    /** Uploaded-file object keys + metadata. The client already PUT the bytes to
     *  R2 (via `useUploadFile`); we only resolve each key to a URL and record it. */
    attachments: v.optional(
      v.array(
        v.object({
          key: v.string(),
          name: v.string(),
          contentType: v.string(),
          size: v.number()
        })
      )
    )
  },
  handler: async (ctx, { channelId, body, replyToId, threadId, clientId, attachments }) => {
    const user = await requireUser(ctx)

    // Replayed from the durable outbox after an app quit (or after an ack was
    // lost): the message may already be here. Return it instead of posting twice.
    if (clientId) {
      const existing = await ctx.db
        .query('messages')
        .withIndex('by_client_id', (q) => q.eq('clientId', clientId))
        .unique()
      if (existing) {
        if (existing.authorId !== user._id) throw new ConvexError('Duplicate message id')
        return existing._id
      }
    }

    // Anti-spam — only genuinely NEW messages count (outbox replays returned above).
    // Generous: normal typing and a durable-outbox backlog drain never trip it.
    await rateLimiter.limit(ctx, 'sendMessage', { key: user._id, throws: true })

    // Owner or accepted-guest access (shared channels). Guests can post like any
    // member — the owner workspace only holds moderation authority.
    const access = await requireChannelAccess(ctx, channelId, user._id)
    const { channel } = access
    // Only `chat` channels and DMs hold messages. Without this a crafted call could
    // bury rows in a page/kanban/voice channel that no view ever surfaces.
    // An announcement channel (`postingPolicy: 'admins'`) is READABLE by everyone with
    // access and writable only by the host's owner/admins. `canPost` is resolved once, in
    // `getChannelAccess`, precisely so a write path can't forget to ask — and this is the
    // write path that would have forgotten. (Caught by the test, not by review.)
    if (!access.canPost) {
      throw new ConvexError(
        channel.postingPolicy === 'selected'
          ? 'This channel is read-only for you'
          : 'Only owners and admins can post in this channel'
      )
    }
    if (channel.kind !== 'chat' && channel.kind !== 'dm') {
      throw new ConvexError('That channel is not a chat channel')
    }
    const trimmed = body.trim()
    // A message needs *something* — text or at least one attachment.
    const files = attachments ?? []
    if (files.length > MAX_ATTACHMENTS) {
      throw new ConvexError(`A message can have at most ${MAX_ATTACHMENTS} attachments`)
    }
    if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
      throw new ConvexError('That file is too large (max 50 MB)')
    }
    if (!trimmed && files.length === 0) throw new ConvexError('Cannot send an empty message')

    // Resolve each uploaded key to a durable URL (public R2 domain, or a signed
    // fallback) so the renderer never has to sign anything, and mark it used so
    // the orphan sweep leaves it alone.
    const resolvedAttachments = await Promise.all(
      files.map(async (file) => {
        await markUploadUsed(ctx, user._id, file.key)
        return { ...file, url: await objectUrl(file.key) }
      })
    )

    // A reply must point at a live message in the same channel. Keep the target
    // — the notification fan-out pings its author.
    let replyTarget: Doc<'messages'> | null = null
    if (replyToId) {
      replyTarget = await ctx.db.get(replyToId)
      if (!replyTarget || replyTarget.channelId !== channelId) {
        throw new ConvexError('The message you replied to no longer exists')
      }
    }

    let thread: Doc<'threads'> | null = null
    if (threadId) {
      thread = await ctx.db.get(threadId)
      if (!thread || thread.channelId !== channelId) {
        throw new ConvexError('That thread no longer exists')
      }
    }

    const createdAt = Date.now()
    const messageId = await ctx.db.insert('messages', {
      channelId,
      workspaceId: channel.workspaceId,
      authorId: user._id,
      body: trimmed,
      createdAt,
      replyToId,
      threadId,
      clientId,
      attachments: resolvedAttachments.length > 0 ? resolvedAttachments : undefined,
      // Born with an (empty) summary, so rendering it never falls back to reading the
      // `messageReactions` table — see the `reactions` note in `schema.ts`.
      reactions: []
    })
    const message = (await ctx.db.get(messageId))!

    if (threadId) {
      await addThreadReply(ctx, threadId, user._id)
    } else {
      // Unread bookkeeping — channel messages only; a thread reply doesn't bold
      // its parent channel. Bump the watermark every reader compares against, and
      // move the *sender's* marker past it: you have by definition read what you
      // just wrote, and everything above it you were looking at while typing.
      await bumpChannelActivity(ctx, channel, createdAt)
      // Stamp the read marker with the sender's ACCESS workspace (their guest
      // workspace for a shared channel), so it clears unread in the sidebar they
      // see the channel in.
      await markChannelRead(ctx, user._id, channel, createdAt, access.accessWorkspaceId)
    }

    // Inbox fan-out: one row per person this message pings (mention / reply /
    // thread). `thread` is re-read fresh so its `participantIds` already include
    // whoever just replied (added by `addThreadReply` above) — harmless, they're
    // the actor and excluded anyway.
    //
    // A **silent message** (`@silent`) skips fan-out entirely — no inbox rows, no reply/thread
    // pings, no OS notification (the NotificationBridge keys off the inbox). It still lands in the
    // channel and bolds it via unread; it just doesn't ping. `bodyIsSilent` is the same directive
    // reader that suppresses the mention pill + highlight (see `mentionsUser`).
    if (!bodyIsSilent(trimmed)) {
      await fanOutNotifications(ctx, {
        message,
        channel,
        actorId: user._id,
        replyTarget,
        thread: threadId ? await ctx.db.get(threadId) : null
      })
    }

    return messageId
  }
})

/** Pin/unpin a message — workspace **owner/admin** only (moderation), mirroring
 *  `_zinx`'s moderator-gated `togglePinMessage`. */
export const togglePin = mutation({
  args: { messageId: v.id('messages') },
  handler: async (ctx, { messageId }) => {
    const user = await requireUser(ctx)
    const message = await ctx.db.get(messageId)
    if (!message) throw new ConvexError('Message not found')
    // Pin is moderation — only the owner workspace's owner/admins, never guests.
    const access = await requireChannelAccess(ctx, message.channelId, user._id)
    if (!access.canModerate) {
      throw new ConvexError('Only owners and admins of the host workspace can pin messages')
    }
    await ctx.db.patch(messageId, { pinned: !message.pinned })
  }
})

/** Edit a message — **author only** (mirrors `_zinx`). Stamps `editedAt`. */
export const edit = mutation({
  args: { messageId: v.id('messages'), body: v.string() },
  handler: async (ctx, { messageId, body }) => {
    const user = await requireUser(ctx)
    const message = await ctx.db.get(messageId)
    if (!message) throw new ConvexError('Message not found')
    if (message.authorId !== user._id) throw new ConvexError('You can only edit your own messages')
    await requireChannelAccess(ctx, message.channelId, user._id)
    const trimmed = body.trim()
    if (!trimmed) throw new ConvexError('Message cannot be empty')
    await ctx.db.patch(messageId, { body: trimmed, editedAt: Date.now() })
  }
})

/** Delete a message — the **author**, or a workspace **owner/admin** (moderation).
 *  Hard delete (Slack/Discord semantics), cascading its reactions.
 *
 *  Deleting a message that roots a thread would orphan the whole conversation, so
 *  it's refused — delete the thread first (Slack behaves the same way). */
export const remove = mutation({
  args: { messageId: v.id('messages') },
  handler: async (ctx, { messageId }) => {
    const user = await requireUser(ctx)
    const message = await ctx.db.get(messageId)
    if (!message) return
    // Author, or an owner/admin of the HOST workspace (guests moderate nothing).
    const access = await requireChannelAccess(ctx, message.channelId, user._id)

    const isAuthor = message.authorId === user._id
    if (!isAuthor && !access.canModerate) {
      throw new ConvexError("You don't have permission to delete this message")
    }

    // If this message roots a thread, deleting it takes the whole thread with it
    // (the UI warns first — see the delete confirm). Delete the thread row now so
    // the indicator/panel clear immediately; its replies + their reactions /
    // attachments / notifications drain in bounded batches via `cleanup.thread`.
    if (message.threadRootId) {
      await ctx.db.delete(message.threadRootId)
      await ctx.scheduler.runAfter(0, internal.cleanup.thread, {
        threadId: message.threadRootId
      })
    }

    const reactions = await ctx.db
      .query('messageReactions')
      .withIndex('by_message', (q) => q.eq('messageId', messageId))
      .collect()
    for (const reaction of reactions) await ctx.db.delete(reaction._id)
    await removeNotificationsForMessage(ctx, messageId)
    // Free this message's uploaded files from R2 (shared with the cascade path).
    await reclaimAttachments(ctx, message.attachments)
    await ctx.db.delete(messageId)

    // Deleting a reply must decrement its thread, or the indicator drifts.
    if (message.threadId) await removeThreadReply(ctx, message.threadId)
  }
})

/** Add/remove the current user's reaction (member-only). Caps distinct emoji. */
export const toggleReaction = mutation({
  args: { messageId: v.id('messages'), emoji: v.string() },
  handler: async (ctx, { messageId, emoji }) => {
    const user = await requireUser(ctx)
    const clean = emoji.trim()
    if (!clean || clean.length > 32) throw new ConvexError('Invalid emoji')

    const message = await ctx.db.get(messageId)
    if (!message) throw new ConvexError('Message not found')
    await requireChannelAccess(ctx, message.channelId, user._id)

    const existing = await ctx.db
      .query('messageReactions')
      .withIndex('by_message_user_emoji', (q) =>
        q.eq('messageId', messageId).eq('userId', user._id).eq('emoji', clean)
      )
      .unique()

    if (existing) {
      await ctx.db.delete(existing._id)
      // An old message may have no summary yet — rebuild it from the (now-current)
      // rows rather than inventing one, so nobody else's reactions are lost.
      const summary =
        message.reactions ??
        summarizeReactionRows(
          await ctx.db
            .query('messageReactions')
            .withIndex('by_message', (q) => q.eq('messageId', messageId))
            .collect()
        )
      await ctx.db.patch(messageId, {
        reactions: message.reactions ? applyReaction(summary, clean, user._id, 'remove') : summary
      })
      return
    }

    // Enforce the distinct-emoji cap only when introducing a NEW emoji. The summary IS
    // the list of distinct emoji, so for a message that already has one (every message
    // born after the field existed — new ones start `reactions: []`) the cap check reads
    // NOTHING; the reaction rows only get read for a legacy summary-less message, which
    // is also the one case that needs them to seed the summary.
    if (message.reactions) {
      const known = message.reactions.some((r) => r.emoji === clean)
      if (!known && message.reactions.length >= MAX_UNIQUE_REACTIONS) {
        throw new ConvexError(
          `A message can have at most ${MAX_UNIQUE_REACTIONS} different reactions`
        )
      }
      await ctx.db.insert('messageReactions', { messageId, userId: user._id, emoji: clean })
      await ctx.db.patch(messageId, {
        reactions: applyReaction(message.reactions, clean, user._id, 'add')
      })
      return
    }

    // Legacy message with no summary yet — read the rows once to both cap-check and seed
    // the summary (starting from an empty one would drop everyone else's reactions).
    const all: Doc<'messageReactions'>[] = await ctx.db
      .query('messageReactions')
      .withIndex('by_message', (q) => q.eq('messageId', messageId))
      .collect()
    const distinct = new Set(all.map((row) => row.emoji))
    if (!distinct.has(clean) && distinct.size >= MAX_UNIQUE_REACTIONS) {
      throw new ConvexError(
        `A message can have at most ${MAX_UNIQUE_REACTIONS} different reactions`
      )
    }
    await ctx.db.insert('messageReactions', { messageId, userId: user._id, emoji: clean })
    await ctx.db.patch(messageId, {
      reactions: applyReaction(summarizeReactionRows(all), clean, user._id, 'add')
    })
  }
})
