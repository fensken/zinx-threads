import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { getMembership } from './auth'
import { getDmParticipantIds, getMyDmChannels } from './dms'
import { getMyChannelIds } from './channelMembers'
import { REACTOR_SAMPLE, summarizeReactionRows } from './reactions'

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

/** A **silent message** carries the `@silent` directive (`zinx://directive/silent`, inserted from
 *  the composer's `@` menu). It is meant to reach the channel WITHOUT pinging anyone — even people
 *  it @-mentions — so it suppresses the inbox fan-out, the sidebar mention pill AND the in-channel
 *  "Mentioned you" highlight. The directive lives in the body (like every other mention), so this
 *  is the one server-side reader; `lib/mention.ts` on the renderer renders it as a "Silent" pill so
 *  readers see why they weren't notified. */
export const SILENT_DIRECTIVE = 'zinx://directive/silent'
export function bodyIsSilent(body: string): boolean {
  return body.includes(SILENT_DIRECTIVE)
}

/** Mentions are stored in the Markdown body as links with a private scheme —
 *  `[@Alice](zinx://user/<id>)`, `[@everyone](zinx://group/everyone)`. Resolving
 *  "does this ping me" server-side mirrors `zinx-os`'s `mentionsMe` flag; doing
 *  it on the client would leak the raw ids into the row and re-derive it per
 *  render. (`lib/mention.ts` on the renderer owns the same format.)
 *
 *  A silent message never pings — so it never "mentions" anyone for notification purposes. This
 *  one guard suppresses BOTH the amber "Mentioned you" row (via `enrichMessages`) AND the sidebar
 *  mention count (via `computeWorkspaceUnread`), since both call through here. */
export function mentionsUser(body: string, userId: string, isModerator: boolean): boolean {
  if (bodyIsSilent(body)) return false
  if (bodyMentionsUserId(body, userId)) return true
  if (body.includes('zinx://group/everyone')) return true
  return isModerator && body.includes('zinx://group/admins')
}

/** True when the body contains a `zinx://user/<userId>` link at a token boundary — i.e. `<id>`
 *  is a WHOLE id, not a prefix of a longer one. A raw `includes()` would let one id that is a
 *  string-prefix of another falsely match, and this must agree with the fan-out reader in
 *  `lib/notifications.ts` (same `[A-Za-z0-9_-]` id charset as `lib/mention.ts` `HREF_RE`). */
export function bodyMentionsUserId(body: string, userId: string): boolean {
  const token = `zinx://user/${userId}`
  for (let from = 0; ; ) {
    const at = body.indexOf(token, from)
    if (at === -1) return false
    const next = body[at + token.length]
    if (next === undefined || !/[A-Za-z0-9_-]/.test(next)) return true
    from = at + token.length
  }
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
  /** A non-human bot principal (`provider: 'bot'`) — badged as a bot in the UI. */
  isBot?: boolean
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
          statusText: doc.statusText,
          isBot: doc.provider === 'bot'
        }
      ] as const
    })
  )
  return new Map(entries)
}

/** One message's reactions, as `{ emoji, count, reacted }`.
 *
 *  Reads the **denormalised summary on the message** (`lib/reactions.ts`) — no table
 *  access at all, which is the whole point: this used to be one index range *per
 *  message*, on the query that runs for every viewer of a channel on every message.
 *
 *  Two fallbacks, both rare:
 *  - No summary at all → a message written before the field existed. Read its rows,
 *    exactly as before. (`toggleReaction` rebuilds the summary the next time anyone
 *    reacts to it; `migrations.backfillReactions` does the rest.)
 *  - A summary whose `userIds` sample was truncated (>`REACTOR_SAMPLE` reactors on
 *    one emoji) and the viewer isn't in it → one indexed lookup to settle `reacted`,
 *    rather than claiming they didn't react. */
async function reactionsFor(
  ctx: QueryCtx,
  message: Doc<'messages'>,
  viewerId: Id<'users'>
): Promise<{ emoji: string; count: number; reacted: boolean }[]> {
  if (!message.reactions) {
    const rows = await ctx.db
      .query('messageReactions')
      .withIndex('by_message', (q) => q.eq('messageId', message._id))
      .collect()
    return summarizeReactionRows(rows).map((entry) => ({
      emoji: entry.emoji,
      count: entry.count,
      reacted: rows.some((row) => row.emoji === entry.emoji && row.userId === viewerId)
    }))
  }

  return await Promise.all(
    message.reactions.map(async (entry) => {
      let reacted = entry.userIds.includes(viewerId)
      if (!reacted && entry.userIds.length >= REACTOR_SAMPLE) {
        reacted = Boolean(
          await ctx.db
            .query('messageReactions')
            .withIndex('by_message_user_emoji', (q) =>
              q.eq('messageId', message._id).eq('userId', viewerId).eq('emoji', entry.emoji)
            )
            .unique()
        )
      }
      return { emoji: entry.emoji, count: entry.count, reacted }
    })
  )
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
    messages.map((message) => reactionsFor(ctx, message, viewer._id))
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

/** Search results shown, and how many hits we read to find them. The gap absorbs the DMs
 *  and private channels the caller isn't in, which are dropped after the index ranks them. */
export const SEARCH_RESULTS = 20
export const SEARCH_SCAN = 50
/** When operators (`from:`/`in:`/`has:`/`before:`/`after:`) narrow the results, scan deeper
 *  so the post-filter still has material to keep `SEARCH_RESULTS`. */
export const SEARCH_SCAN_FILTERED = 200

/** The operator filters parsed out of a Slack-style search query. */
export interface SearchFilters {
  /** Author name substring (`from:alice`). */
  from?: string
  /** Channel-name substring (`in:general`). */
  in?: string
  /** `has:link` / `has:file` / `has:image`. */
  has?: 'link' | 'file' | 'image'
  /** `before:YYYY-MM-DD` — exclusive upper bound (epoch ms). */
  before?: number
  /** `after:YYYY-MM-DD` — inclusive lower bound (epoch ms). */
  after?: number
}

/**
 * Parse Slack-style search operators out of a raw query. Returns the leftover free-text
 * `term` plus the structured `filters`. Unknown `word:value` tokens are treated as plain
 * text (so `http://` etc. aren't eaten). Shared by the palette and the MCP tool via
 * `searchMessagesForUser`, so both understand the same operators.
 */
export function parseSearchQuery(raw: string): { term: string; filters: SearchFilters } {
  const filters: SearchFilters = {}
  const rest: string[] = []
  for (const token of raw.split(/\s+/)) {
    const match = /^(from|in|has|before|after):(.+)$/i.exec(token)
    if (!match) {
      if (token) rest.push(token)
      continue
    }
    const key = match[1].toLowerCase()
    const value = match[2]
    if (key === 'from') filters.from = value.replace(/^@/, '').toLowerCase()
    else if (key === 'in') filters.in = value.replace(/^#/, '').toLowerCase()
    else if (key === 'has') {
      const v = value.toLowerCase()
      if (v === 'link' || v === 'file' || v === 'image') filters.has = v
      else rest.push(token)
    } else if (key === 'before' || key === 'after') {
      const parsed = Date.parse(value)
      if (Number.isNaN(parsed)) rest.push(token)
      else filters[key] = parsed
    }
  }
  return { term: rest.join(' ').trim(), filters }
}

const LINK_RE = /https?:\/\/\S+/i
/** Does a hit satisfy the non-text operators? (Text is handled by the search index.) */
function matchesFilters(
  message: Doc<'messages'>,
  filters: SearchFilters,
  channelLabel: string,
  authorName: string
): boolean {
  if (filters.from && !authorName.toLowerCase().includes(filters.from)) return false
  if (filters.in && !channelLabel.toLowerCase().includes(filters.in)) return false
  if (filters.before !== undefined && message.createdAt >= filters.before) return false
  if (filters.after !== undefined && message.createdAt < filters.after) return false
  if (filters.has === 'link' && !LINK_RE.test(message.body)) return false
  if (filters.has === 'file' && !(message.attachments && message.attachments.length > 0)) return false
  if (
    filters.has === 'image' &&
    !message.attachments?.some((a) => a.contentType.startsWith('image/'))
  ) {
    return false
  }
  return true
}

/** One shape for a full-text search hit — returned to the chat palette AND to the MCP
 *  `search_messages` tool, so the two can never diverge on what a caller may see. */
export interface SearchHit {
  _id: Id<'messages'>
  channelId: Id<'channels'>
  /** For a DM this is the other participants' names, never the internal `dm-<key>`. */
  channelName: string
  isDm: boolean
  body: string
  createdAt: number
  authorName: string
  authorColor: string | undefined
  authorAvatarUrl: string | undefined
}

/**
 * Full-text message search for one user in one workspace — the single definition, shared by
 * the public `messages.searchInWorkspace` query and the token-authenticated MCP tool.
 *
 * **The most dangerous surface in the app.** The search index can only filter on equality,
 * and the only thing it's keyed on is `workspaceId` — so it WILL match messages in other
 * people's DMs and in private channels the caller isn't in. "Not someone else's room" cannot
 * be expressed in the index. So: over-fetch `SEARCH_SCAN`, drop everything the caller can't
 * see, keep the top `SEARCH_RESULTS`. The caller passes their OWN `user` — the MCP path
 * resolves it from the token, never from a JWT — so the same filtering protects both.
 */
export async function searchMessagesForUser(
  ctx: QueryCtx,
  user: Doc<'users'>,
  workspaceId: Id<'workspaces'>,
  term: string
): Promise<SearchHit[]> {
  const { term: trimmed, filters } = parseSearchQuery(term)
  // A text term is still required — the search index can't range without one. Operators
  // refine that text query (Slack's model when you type only operators is a different,
  // scan-based path we don't take here).
  if (!trimmed) return []

  const hasFilters =
    filters.from !== undefined ||
    filters.in !== undefined ||
    filters.has !== undefined ||
    filters.before !== undefined ||
    filters.after !== undefined

  const hits = await ctx.db
    .query('messages')
    .withSearchIndex('search_body', (q) =>
      q.search('body', trimmed).eq('workspaceId', workspaceId).eq('threadId', undefined)
    )
    .take(hasFilters ? SEARCH_SCAN_FILTERED : SEARCH_SCAN)

  const myDmIds = new Set(
    (await getMyDmChannels(ctx, workspaceId, user._id)).map((c) => c._id as string)
  )
  const membership = await getMembership(ctx, workspaceId, user._id)
  const myChannelIds = await getMyChannelIds(ctx, workspaceId, user._id)

  const authors = await resolveAuthors(
    ctx,
    workspaceId,
    hits.map((m) => m.authorId)
  )
  const channelCache = new Map<string, { label: string; isDm: boolean; visible: boolean }>()
  const results: SearchHit[] = []
  for (const message of hits) {
    if (results.length >= SEARCH_RESULTS) break
    const key = message.channelId as string
    if (!channelCache.has(key)) {
      const channel = await ctx.db.get(message.channelId)
      if (channel?.kind === 'dm') {
        const others = (await getDmParticipantIds(ctx, channel._id)).filter((id) => id !== user._id)
        const people = await resolveAuthors(ctx, workspaceId, others)
        const label = others.map((id) => people.get(id)?.name ?? 'Unknown').join(', ')
        channelCache.set(key, {
          label: label || 'Direct message',
          isDm: true,
          visible: myDmIds.has(key)
        })
      } else {
        const isPrivate = channel?.visibility === 'private'
        const isGuest = membership?.role === 'guest'
        channelCache.set(key, {
          label: channel?.name ?? 'unknown',
          isDm: false,
          visible: channel !== null && (!(isPrivate || isGuest) || myChannelIds.has(key))
        })
      }
    }
    const channelInfo = channelCache.get(key)
    if (!channelInfo?.visible) continue

    if (hasFilters) {
      const authorName = authors.get(message.authorId)?.name ?? 'Unknown'
      if (!matchesFilters(message, filters, channelInfo.label, authorName)) continue
    }

    results.push({
      _id: message._id,
      channelId: message.channelId,
      channelName: channelInfo.label,
      isDm: channelInfo.isDm,
      body: message.body,
      createdAt: message.createdAt,
      authorName: authors.get(message.authorId)?.name ?? 'Unknown',
      authorColor: authors.get(message.authorId)?.color,
      authorAvatarUrl: authors.get(message.authorId)?.avatarUrl
    })
  }
  return results
}
