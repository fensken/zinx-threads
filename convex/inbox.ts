import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'
import { resolveAuthors } from './lib/messages'

/** Inbox depth. Older-than-this notifications still exist (they back the badge on
 *  a hard refresh); the list just shows the most recent page. */
const INBOX_PAGE = 50

export interface InboxItem {
  _id: Id<'notifications'>
  kind: Doc<'notifications'>['kind']
  channelId: Id<'channels'>
  channelName: string
  channelKind: Doc<'channels'>['kind']
  messageId: Id<'messages'>
  threadId?: Id<'threads'>
  /** The message body, so the client renders the same preview as everywhere else. */
  body: string
  createdAt: number
  read: boolean
  actorName: string
  actorColor?: string
  actorAvatarUrl?: string | null
}

/** Your Inbox for one workspace — mentions, replies and thread activity, newest
 *  first. Null-safe (`[]`), like every query here. Enriches each row with the
 *  actor and the channel so the flyout renders without a second pass. */
export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }): Promise<InboxItem[]> => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const rows = await ctx.db
      .query('notifications')
      .withIndex('by_user_workspace_created', (q) =>
        q.eq('userId', user._id).eq('workspaceId', workspaceId)
      )
      .order('desc')
      .take(INBOX_PAGE)

    const authors = await resolveAuthors(
      ctx,
      workspaceId,
      rows.map((row) => row.actorId)
    )
    // A handful of distinct channels — small and bounded, so a per-row get is fine.
    const channelCache = new Map<string, Doc<'channels'> | null>()
    const getChannel = async (id: Id<'channels'>): Promise<Doc<'channels'> | null> => {
      const key = id as string
      if (!channelCache.has(key)) channelCache.set(key, await ctx.db.get(id))
      return channelCache.get(key) ?? null
    }

    const out: InboxItem[] = []
    for (const row of rows) {
      const message = await ctx.db.get(row.messageId)
      // The message was deleted but its notification lingered (a delete that
      // didn't cascade, e.g. a legacy row) — skip it rather than render a ghost.
      if (!message) continue
      const channel = await getChannel(row.channelId)
      const actor = authors.get(row.actorId)
      out.push({
        _id: row._id,
        kind: row.kind,
        channelId: row.channelId,
        channelName: channel?.name ?? 'unknown',
        channelKind: channel?.kind ?? 'chat',
        messageId: row.messageId,
        threadId: row.threadId,
        body: message.body,
        createdAt: row.createdAt,
        read: row.readAt !== undefined,
        actorName: actor?.name ?? 'Unknown',
        actorColor: actor?.color,
        actorAvatarUrl: actor?.avatarUrl
      })
    }
    return out
  }
})

/** How many unread notifications you have in a workspace — the number on the
 *  Inbox nav item. Capped: past `INBOX_PAGE` we render `N+`, so the badge never
 *  drives an unbounded scan. */
export const unreadCount = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }): Promise<{ count: number; overflow: boolean }> => {
    const user = await getCurrentUser(ctx)
    if (!user) return { count: 0, overflow: false }
    if (!(await getMembership(ctx, workspaceId, user._id))) return { count: 0, overflow: false }

    // Unread rows only, via the index — `readAt: undefined` is a real indexed
    // value in Convex, so no `.filter()`.
    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user_workspace_read', (q) =>
        q.eq('userId', user._id).eq('workspaceId', workspaceId).eq('readAt', undefined)
      )
      .take(INBOX_PAGE + 1)
    return { count: Math.min(unread.length, INBOX_PAGE), overflow: unread.length > INBOX_PAGE }
  }
})

/** Clear one notification from the Inbox (opening it, or dismissing it). */
export const markRead = mutation({
  args: { notificationId: v.id('notifications') },
  handler: async (ctx, { notificationId }) => {
    const user = await requireUser(ctx)
    const notification = await ctx.db.get(notificationId)
    if (!notification) return
    // Only your own inbox is yours to clear.
    if (notification.userId !== user._id) throw new ConvexError('Not your notification')
    if (notification.readAt === undefined) {
      await ctx.db.patch(notificationId, { readAt: Date.now() })
    }
  }
})

/** Clear the whole Inbox for a workspace. Bounded by the unread page — a client
 *  that somehow has more than `INBOX_PAGE` unread clears them across repeat calls,
 *  which is fine for a "mark all read" affordance. */
export const markAllRead = mutation({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await requireUser(ctx)
    if (!(await getMembership(ctx, workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    const now = Date.now()
    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user_workspace_read', (q) =>
        q.eq('userId', user._id).eq('workspaceId', workspaceId).eq('readAt', undefined)
      )
      .take(INBOX_PAGE)
    for (const row of unread) await ctx.db.patch(row._id, { readAt: now })
  }
})
