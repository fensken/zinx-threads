import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { getCurrentUser, requireUser } from './lib/auth'
import { getDmParticipantIds } from './lib/dms'
import { resolveAuthors } from './lib/messages'

/**
 * The Inbox is **the user's, not a workspace's.**
 *
 * "Someone mentioned me" doesn't stop at a workspace boundary — you don't want to
 * check four inboxes to find out whether anyone needs you. So every read here is
 * keyed on `userId` alone and spans every workspace you belong to; each row carries
 * the workspace it happened in, which is how the UI labels and routes it.
 *
 * (The per-channel unread state in the sidebar is the opposite and stays that way:
 * *that* is about one workspace's channels.)
 */

/** How deep the page goes, and the ceiling on the badge. Past this the badge shows
 *  `N+` rather than driving an unbounded scan. */
const INBOX_PAGE = 50
const BADGE_CAP = 99

/** `kind` is the reason it's in your inbox — the filter tabs are exactly this. */
export const notificationKind = v.union(
  v.literal('mention'),
  v.literal('reply'),
  v.literal('thread'),
  v.literal('dm')
)

export interface InboxItem {
  _id: Id<'notifications'>
  kind: Doc<'notifications'>['kind']
  workspaceId: Id<'workspaces'>
  /** Which workspace it happened in — the row says so, and clicking it goes there. */
  workspaceName: string
  workspaceSlug: string
  channelId: Id<'channels'>
  /** For a DM this is the other participants' names — **never** the internal
   *  `dm-<ids>` channel name, which is an id in disguise. */
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

/**
 * Your whole Inbox, newest first, optionally narrowed by **type** and by **date**.
 *
 * Both filters are index ranges, never `.filter()`: `kind` selects the
 * `by_user_kind_created` index (where an equality on kind still leaves `createdAt`
 * as the range field), and `since`/`until` are the range bounds on either index.
 * A date filter therefore costs the rows it returns, not the rows it skips.
 */
export const listForMe = query({
  args: {
    kind: v.optional(notificationKind),
    /** Inclusive lower bound (epoch ms) — "since Monday". */
    since: v.optional(v.number()),
    /** Exclusive upper bound (epoch ms). */
    until: v.optional(v.number()),
    limit: v.optional(v.number())
  },
  handler: async (ctx, { kind, since, until, limit }): Promise<InboxItem[]> => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const take = Math.min(Math.max(limit ?? INBOX_PAGE, 1), INBOX_PAGE)

    const rows = kind
      ? await ctx.db
          .query('notifications')
          .withIndex('by_user_kind_created', (q) => {
            const base = q.eq('userId', user._id).eq('kind', kind)
            if (since !== undefined && until !== undefined) {
              return base.gte('createdAt', since).lt('createdAt', until)
            }
            if (since !== undefined) return base.gte('createdAt', since)
            if (until !== undefined) return base.lt('createdAt', until)
            return base
          })
          .order('desc')
          .take(take)
      : await ctx.db
          .query('notifications')
          .withIndex('by_user_created', (q) => {
            const base = q.eq('userId', user._id)
            if (since !== undefined && until !== undefined) {
              return base.gte('createdAt', since).lt('createdAt', until)
            }
            if (since !== undefined) return base.gte('createdAt', since)
            if (until !== undefined) return base.lt('createdAt', until)
            return base
          })
          .order('desc')
          .take(take)

    // Names are per-workspace (a nickname overrides the account name), so the actor
    // lookup has to be done per workspace rather than once globally. A page spans a
    // handful of workspaces at most.
    const byWorkspace = new Map<string, Id<'users'>[]>()
    for (const row of rows) {
      const key = row.workspaceId as string
      const bucket = byWorkspace.get(key)
      if (bucket) bucket.push(row.actorId)
      else byWorkspace.set(key, [row.actorId])
    }
    const authors = new Map<string, Awaited<ReturnType<typeof resolveAuthors>>>()
    for (const [workspaceId, actorIds] of byWorkspace) {
      authors.set(workspaceId, await resolveAuthors(ctx, workspaceId as Id<'workspaces'>, actorIds))
    }

    const workspaceCache = new Map<string, Doc<'workspaces'> | null>()
    const channelCache = new Map<string, { name: string; kind: Doc<'channels'>['kind'] }>()

    const out: InboxItem[] = []
    for (const row of rows) {
      const message = await ctx.db.get(row.messageId)
      // The message is gone but its notification lingered (a legacy row that
      // predates the cascade) — skip it rather than render a ghost.
      if (!message) continue

      const wsKey = row.workspaceId as string
      if (!workspaceCache.has(wsKey)) workspaceCache.set(wsKey, await ctx.db.get(row.workspaceId))
      const workspace = workspaceCache.get(wsKey) ?? null
      // You left the workspace but the row survived — it's no longer yours to see.
      if (!workspace) continue

      const chKey = row.channelId as string
      if (!channelCache.has(chKey)) {
        const channel = await ctx.db.get(row.channelId)
        if (channel?.kind === 'dm') {
          // Label a DM by *who it's with*. Its stored name is an id.
          const others = (await getDmParticipantIds(ctx, channel._id)).filter(
            (id) => id !== user._id
          )
          const people = await resolveAuthors(ctx, row.workspaceId, others)
          const label = others.map((id) => people.get(id)?.name ?? 'Unknown').join(', ')
          channelCache.set(chKey, { name: label || 'Direct message', kind: 'dm' })
        } else {
          channelCache.set(chKey, {
            name: channel?.name ?? 'unknown',
            kind: channel?.kind ?? 'chat'
          })
        }
      }
      const channel = channelCache.get(chKey)!
      const actor = authors.get(wsKey)?.get(row.actorId)

      out.push({
        _id: row._id,
        kind: row.kind,
        workspaceId: row.workspaceId,
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        channelId: row.channelId,
        channelName: channel.kind === 'dm' ? '' : channel.name,
        channelKind: channel.kind,
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

/** How many unread notifications you have, across every workspace — the number on
 *  the Inbox nav item and the header button. Capped: past `BADGE_CAP` we render
 *  `N+`, so a badge never drives an unbounded scan. */
export const unreadCountForMe = query({
  args: {},
  handler: async (ctx): Promise<{ count: number; overflow: boolean }> => {
    const user = await getCurrentUser(ctx)
    if (!user) return { count: 0, overflow: false }

    // `readAt: undefined` is a real indexed value in Convex, so unread-only is an
    // index lookup, not a filter.
    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user_read', (q) => q.eq('userId', user._id).eq('readAt', undefined))
      .take(BADGE_CAP + 1)
    return { count: Math.min(unread.length, BADGE_CAP), overflow: unread.length > BADGE_CAP }
  }
})

/** Clear one notification (opening it, or dismissing it). */
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

/** Mark one notification unread again — the undo for a misclick, and the only way
 *  back once a row is cleared. */
export const markUnread = mutation({
  args: { notificationId: v.id('notifications') },
  handler: async (ctx, { notificationId }) => {
    const user = await requireUser(ctx)
    const notification = await ctx.db.get(notificationId)
    if (!notification) return
    if (notification.userId !== user._id) throw new ConvexError('Not your notification')
    if (notification.readAt !== undefined) {
      await ctx.db.patch(notificationId, { readAt: undefined })
    }
  }
})

/** Clear the whole Inbox, across every workspace. Bounded per call — someone with a
 *  huge backlog clears it over repeated calls, which is fine for a "mark all read"
 *  button and keeps this off the unbounded-write path. */
export const markAllReadForMe = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    const now = Date.now()
    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_user_read', (q) => q.eq('userId', user._id).eq('readAt', undefined))
      .take(INBOX_PAGE * 2)
    for (const row of unread) await ctx.db.patch(row._id, { readAt: now })
    return { cleared: unread.length }
  }
})
