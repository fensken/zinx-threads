import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { getMembership } from './auth'

/** Distinct emoji allowed on one message (matches `_zinx`'s cap). */
export const MAX_UNIQUE_REACTIONS = 20

/** Most-recent messages loaded per thread (threads are short — no scrollback). */
export const MESSAGE_PAGE = 200

/** Channel scrollback is a **growing window**, not cursor pagination: the client
 *  asks for the newest N (default `CHANNEL_PAGE`) and grows N by a page each time
 *  it scrolls to the top — so the query stays a single reactive `useQuery` (cached
 *  channel-switches + working optimistic reactions), just over a wider window.
 *  Bounded by `CHANNEL_PAGE_MAX`; past that a channel wants true cursor
 *  pagination, but this covers ordinary history without the complexity. */
export const CHANNEL_PAGE = 50
export const CHANNEL_PAGE_MAX = 1000

/** Mentions are stored in the Markdown body as links with a private scheme —
 *  `[@Alice](zinx://user/<id>)`, `[@everyone](zinx://group/everyone)`. Resolving
 *  "does this ping me" server-side mirrors `zinx-os`'s `mentionsMe` flag; doing
 *  it on the client would leak the raw ids into the row and re-derive it per
 *  render. (`lib/mention.ts` on the renderer owns the same format.) */
export function mentionsUser(body: string, userId: string, isModerator: boolean): boolean {
  if (body.includes(`zinx://user/${userId}`)) return true
  if (body.includes('zinx://group/everyone')) return true
  return isModerator && body.includes('zinx://group/admins')
}

/** An author's display fields, resolved once per distinct user. The effective
 *  name is their per-workspace nickname if set, else their global account name. */
export interface MessageAuthor {
  name: string
  color?: string
  avatarUrl?: string
  /** The author's *static* status — this app has no heartbeat presence. */
  presence?: Doc<'users'>['presence']
  statusEmoji?: string
  statusText?: string
}

export async function resolveAuthors(
  ctx: QueryCtx,
  workspaceId: Id<'workspaces'>,
  userIds: Id<'users'>[]
): Promise<Map<Id<'users'>, MessageAuthor | null>> {
  const distinct = [...new Set(userIds)]
  const entries = await Promise.all(
    distinct.map(async (id) => {
      const doc = await ctx.db.get(id)
      if (!doc) return [id, null] as const
      const membership = await getMembership(ctx, workspaceId, id)
      const name = membership?.displayName?.trim() || doc.name || doc.email
      return [
        id,
        {
          name,
          color: doc.color,
          avatarUrl: doc.avatarUrl,
          presence: doc.presence,
          statusEmoji: doc.statusEmoji,
          statusText: doc.statusText
        }
      ] as const
    })
  )
  return new Map(entries)
}

/** Group one message's reactions into `{ emoji, count, reacted }`. */
async function reactionsFor(
  ctx: QueryCtx,
  messageId: Id<'messages'>,
  viewerId: Id<'users'>
): Promise<{ emoji: string; count: number; reacted: boolean }[]> {
  const rows = await ctx.db
    .query('messageReactions')
    .withIndex('by_message', (q) => q.eq('messageId', messageId))
    .collect()
  const grouped = new Map<string, { emoji: string; count: number; reacted: boolean }>()
  for (const row of rows) {
    const entry = grouped.get(row.emoji) ?? { emoji: row.emoji, count: 0, reacted: false }
    entry.count += 1
    if (row.userId === viewerId) entry.reacted = true
    grouped.set(row.emoji, entry)
  }
  return [...grouped.values()]
}

/** Turn a raw page of messages into the shape the message list renders: author
 *  display fields, grouped reactions, the resolved inline-reply quote, and the
 *  viewer-relative `isAuthor` / `mentionsMe` flags.
 *
 *  Shared by `messages.listByChannel` and `threads.listMessages` — a thread reply
 *  is an ordinary message and must render identically. */
export async function enrichMessages(
  ctx: QueryCtx,
  options: {
    messages: Doc<'messages'>[]
    workspaceId: Id<'workspaces'>
    viewer: Doc<'users'>
    isModerator: boolean
  }
) {
  const { messages, workspaceId, viewer, isModerator } = options

  // Resolve each distinct reply target once (inline quote, NOT a thread).
  const replyIds = [...new Set(messages.flatMap((m) => (m.replyToId ? [m.replyToId] : [])))]
  const replyDocs = await Promise.all(replyIds.map((replyId) => ctx.db.get(replyId)))

  // Reply-target authors may sit outside the loaded page — fold them into the
  // same lookup rather than issuing a second round of reads.
  const authors = await resolveAuthors(ctx, workspaceId, [
    ...messages.map((m) => m.authorId),
    ...replyDocs.flatMap((doc) => (doc ? [doc.authorId] : []))
  ])

  const replies = new Map(
    replyIds.map((replyId, index) => {
      const doc = replyDocs[index]
      if (!doc) return [replyId, null] as const
      const author = authors.get(doc.authorId)
      return [
        replyId,
        {
          _id: doc._id,
          body: doc.body,
          authorName: author?.name ?? 'Unknown',
          authorAvatarUrl: author?.avatarUrl,
          authorColor: author?.color,
          /** Drives the "Replied to you" highlight. */
          authorIsMe: doc.authorId === viewer._id
        }
      ] as const
    })
  )

  const reactions = await Promise.all(
    messages.map((message) => reactionsFor(ctx, message._id, viewer._id))
  )

  return messages.map((m, index) => {
    const isAuthor = m.authorId === viewer._id
    return {
      ...m,
      author: authors.get(m.authorId) ?? null,
      reactions: reactions[index],
      replyTo: m.replyToId ? (replies.get(m.replyToId) ?? null) : null,
      /** Lets the client show author-only affordances without leaking ids. */
      isAuthor,
      /** `@you`, `@everyone`, or `@admins` when you're one — never your own. */
      mentionsMe: !isAuthor && mentionsUser(m.body, viewer._id, isModerator)
    }
  })
}
