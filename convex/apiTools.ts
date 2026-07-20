import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import {
  canPostIn,
  getChannelAccess,
  getMembership,
  getMemberships,
  requireChannelAccess
} from './lib/auth'
import { listRealChannels } from './lib/channels'
import { getMyChannelIds, visibleChannels } from './lib/channelMembers'
import { resolveAuthors, searchMessagesForUser } from './lib/messages'
import { computeWorkspaceUnread, markChannelRead } from './lib/unread'
import { watermarks } from './lib/activity'
import { postMessageInChannel } from './lib/post'
import { removeNotificationsForMessage } from './lib/notifications'
import { applyReaction, summarizeReactionRows } from './lib/reactions'
import { rateLimiter } from './rateLimiter'
import { seedBoardColumns } from './lib/boardSeed'
import { seedDatabase } from './lib/databaseSeed'
import { seedForm } from './lib/formSeed'
import { taskPriority } from './schema'
import { rsvpStatus } from './events'

/**
 * The **capability layer** — the one implementation of every action the public API exposes,
 * as internal functions that take an explicit `userId` (the token-resolved actor) instead of
 * reading `ctx.auth`. This is what makes ONE definition serve all three developer surfaces:
 *
 *   • the **MCP connector** (Claude / ChatGPT) — `convex/lib/mcp.ts` dispatches tool calls here,
 *   • the **REST API** (`POST /api/v1/tools/<name>`) — `convex/http.ts` runs the same dispatch,
 *   • **bots** — a bot token resolves to the bot's user id and drives the exact same functions.
 *
 * Every function goes through the SAME permission gates the app's own mutations use
 * (`getChannelAccess` / `canPost` / `getMembership` / organiser-only / author-only), so a
 * token can only ever do what its owner can. A private channel the actor can't see stays
 * invisible; a read-only channel refuses a post; a task in a workspace they're not in is not
 * found. Ids ARE exposed here (unlike the human-facing UI, which never shows them) — this is a
 * machine API, and ids are the handles write tools reference. Exposing one grants nothing: the
 * write path re-checks access from it.
 *
 * When you add a feature, add its capability here + a tool entry in `convex/lib/mcp.ts`
 * (TOOLS + callTool) + a row in the `/docs` capability table — and it lands in MCP, the REST
 * API and bots at once.
 */

const MAX_TITLE = 200
const MAX_MESSAGES = 50
const MAX_TASKS = 500
const MAX_COLUMNS = 30
const MAX_LABELS = 20

// ---------------------------------------------------------------------------
// Shared resolvers — the gates every tool goes through
// ---------------------------------------------------------------------------

type ReaderCtx = Parameters<typeof getMembership>[0]

/** (actor, workspace slug) → the user doc, workspace id and membership, or null if the slug is
 *  unknown or the actor isn't a member. */
async function resolveMember(
  ctx: ReaderCtx,
  userId: Id<'users'>,
  slug: string
): Promise<{
  user: Doc<'users'>
  workspaceId: Id<'workspaces'>
  membership: Doc<'workspaceMembers'>
} | null> {
  const user = await ctx.db.get(userId)
  if (!user) return null
  const workspace = await ctx.db
    .query('workspaces')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique()
  if (!workspace) return null
  const membership = await getMembership(ctx, workspace._id, userId)
  if (!membership) return null
  return { user, workspaceId: workspace._id, membership }
}

/** Find a channel by (workspace slug, channel name) the actor may SEE. Case-insensitive; only
 *  channels `visibleChannels` allows — a private channel the actor isn't in resolves to null
 *  (not an error that would confirm it exists). */
async function resolveVisibleChannel(
  ctx: ReaderCtx,
  userId: Id<'users'>,
  slug: string,
  channelName: string
): Promise<{ channel: Doc<'channels'>; workspaceId: Id<'workspaces'> } | null> {
  const resolved = await resolveMember(ctx, userId, slug)
  if (!resolved) return null
  const mine = await getMyChannelIds(ctx, resolved.workspaceId, userId)
  const visible = visibleChannels(
    await listRealChannels(ctx, resolved.workspaceId),
    resolved.membership.role,
    mine
  )
  // Prefer an EXACT name match, then fall back to case-insensitive. Channel names created via the
  // app are slugified (lowercase), so this rarely matters — but demo/seed data can hold two
  // channels differing only by case (a chat `general` and a voice `General`), and a blind
  // lowercase match would silently pick the wrong one.
  const raw = channelName.trim().replace(/^#/, '')
  const wanted = raw.toLowerCase()
  const channel =
    visible.find((c) => c.name === raw) ?? visible.find((c) => c.name.toLowerCase() === wanted)
  return channel ? { channel, workspaceId: resolved.workspaceId } : null
}

/** Resolve a message by its id string for the actor, checking channel access. Throws a clean
 *  ConvexError if the id is malformed, the message is gone, or the actor can't see the channel. */
async function requireMessage(
  ctx: ReaderCtx,
  userId: Id<'users'>,
  messageStr: string
): Promise<{ message: Doc<'messages'>; canModerate: boolean }> {
  const id = ctx.db.normalizeId('messages', messageStr)
  if (!id) throw new ConvexError('Unknown message id')
  const message = await ctx.db.get(id)
  if (!message) throw new ConvexError('Message not found')
  const access = await getChannelAccess(ctx, message.channelId, userId)
  if (!access) throw new ConvexError('You do not have access to this message')
  return { message, canModerate: access.canModerate }
}

/** Resolve a board channel (kind `kanban`) the actor is a member of, by (slug, channel name). */
async function requireBoardChannel(
  ctx: ReaderCtx,
  userId: Id<'users'>,
  slug: string,
  channelName: string
): Promise<Doc<'channels'>> {
  const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
  if (!resolved) throw new ConvexError(`No channel "${channelName}" you can see in "${slug}"`)
  if (resolved.channel.kind !== 'kanban') throw new ConvexError('That channel is not a board')
  return resolved.channel
}

/** Resolve a column on a board by id OR by title (case-insensitive). */
async function resolveColumn(
  ctx: ReaderCtx,
  channel: Doc<'channels'>,
  columnRef: string
): Promise<Doc<'kanbanColumns'> | null> {
  const columns = await ctx.db
    .query('kanbanColumns')
    .withIndex('by_channel', (q) => q.eq('channelId', channel._id))
    .take(MAX_COLUMNS)
  const id = ctx.db.normalizeId('kanbanColumns', columnRef)
  if (id) {
    const byId = columns.find((c) => c._id === id)
    if (byId) return byId
  }
  const wanted = columnRef.trim().toLowerCase()
  return columns.find((c) => c.title.toLowerCase() === wanted) ?? null
}

/** Get a task by id for the actor, checking **channel** access (not just workspace
 *  membership) — a task in a private board an admin isn't a member of stays off-limits,
 *  matching `boards.ts`. */
async function requireTask(
  ctx: ReaderCtx,
  userId: Id<'users'>,
  taskStr: string
): Promise<Doc<'kanbanTasks'>> {
  const id = ctx.db.normalizeId('kanbanTasks', taskStr)
  if (!id) throw new ConvexError('Unknown task id')
  const task = await ctx.db.get(id)
  if (!task) throw new ConvexError('Task not found')
  await requireChannelAccess(ctx, task.channelId, userId)
  return task
}

/** Get a column by id for the actor, checking **channel** access (see `requireTask`). */
async function requireColumn(
  ctx: ReaderCtx,
  userId: Id<'users'>,
  columnStr: string
): Promise<Doc<'kanbanColumns'>> {
  const id = ctx.db.normalizeId('kanbanColumns', columnStr)
  if (!id) throw new ConvexError('Unknown column id')
  const column = await ctx.db.get(id)
  if (!column) throw new ConvexError('Column not found')
  await requireChannelAccess(ctx, column.channelId, userId)
  return column
}

/** Get an event by id for the actor, checking workspace membership. */
async function requireEvent(
  ctx: ReaderCtx,
  userId: Id<'users'>,
  eventStr: string
): Promise<Doc<'events'>> {
  const id = ctx.db.normalizeId('events', eventStr)
  if (!id) throw new ConvexError('Unknown event id')
  const event = await ctx.db.get(id)
  if (!event) throw new ConvexError('Event not found')
  if (!(await getMembership(ctx, event.workspaceId, userId))) {
    throw new ConvexError('Not a member of this workspace')
  }
  return event
}

// ===========================================================================
// READS
// ===========================================================================

/** `list_workspaces` — the workspaces this user belongs to (needed first: everything else
 *  takes a workspace slug). */
export const workspacesFor = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const memberships = await getMemberships(ctx, userId)
    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const workspace = await ctx.db.get(membership.workspaceId)
        if (!workspace) return null
        return { slug: workspace.slug, name: workspace.name, role: membership.role }
      })
    )
    return rows.filter((row): row is NonNullable<typeof row> => row !== null)
  }
})

/** `list_channels` — the channels the user can see in a workspace + whether they may post. */
export const channelsFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string() },
  handler: async (ctx, { userId, slug }) => {
    const resolved = await resolveMember(ctx, userId, slug)
    if (!resolved) return []
    const { workspaceId, membership } = resolved
    const mine = await getMyChannelIds(ctx, workspaceId, userId)
    const isModerator = membership.role === 'owner' || membership.role === 'admin'
    return visibleChannels(await listRealChannels(ctx, workspaceId), membership.role, mine).map(
      (channel) => ({
        id: channel._id,
        name: channel.name,
        kind: channel.kind,
        visibility: channel.visibility ?? 'public',
        canPost: canPostIn(channel, isModerator, mine.get(channel._id as string) ?? null)
      })
    )
  }
})

/** `list_members` — the people (and bots) in a workspace, with their role. */
export const membersFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string() },
  handler: async (ctx, { userId, slug }) => {
    const resolved = await resolveMember(ctx, userId, slug)
    if (!resolved) return []
    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', resolved.workspaceId))
      .collect()
    const rows = await Promise.all(
      members.map(async (m) => {
        const u = await ctx.db.get(m.userId)
        if (!u) return null
        return {
          id: u._id,
          name: m.displayName || u.name || u.email,
          role: m.role,
          isBot: u.provider === 'bot'
        }
      })
    )
    return rows.filter((row): row is NonNullable<typeof row> => row !== null)
  }
})

/** `list_messages` — the most recent messages in a channel (newest last), each with its id so
 *  edit / delete / react can reference it. */
export const listMessagesFor = internalQuery({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    channel: v.string(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, { userId, slug, channel: channelName, limit }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved) return []
    const take = Math.min(Math.max(limit ?? 20, 1), MAX_MESSAGES)
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_channel_thread_created', (q) =>
        q.eq('channelId', resolved.channel._id).eq('threadId', undefined)
      )
      .order('desc')
      .take(take)
    rows.reverse()
    const authors = await resolveAuthors(
      ctx,
      resolved.workspaceId,
      rows.map((r) => r.authorId)
    )
    return rows.map((r) => ({
      id: r._id,
      author: authors.get(r.authorId)?.name ?? 'Unknown',
      body: r.body,
      pinned: r.pinned ?? false,
      at: new Date(r.createdAt).toISOString()
    }))
  }
})

/** `search_messages` — full-text search across everything the user can read in a workspace. */
export const searchFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string(), term: v.string() },
  handler: async (ctx, { userId, slug, term }) => {
    const resolved = await resolveMember(ctx, userId, slug)
    if (!resolved) return []
    const hits = await searchMessagesForUser(ctx, resolved.user, resolved.workspaceId, term)
    return hits.map((hit) => ({
      id: hit._id,
      channel: hit.channelName,
      isDm: hit.isDm,
      author: hit.authorName,
      body: hit.body,
      at: new Date(hit.createdAt).toISOString()
    }))
  }
})

/** `list_unread` — which channels have unread activity, and how many pings. */
export const unreadFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string() },
  handler: async (ctx, { userId, slug }) => {
    const resolved = await resolveMember(ctx, userId, slug)
    if (!resolved) return []
    const { user, membership, workspaceId } = resolved
    const rows = await computeWorkspaceUnread(ctx, user, membership, workspaceId)
    return await Promise.all(
      rows.map(async (row) => {
        const channel = await ctx.db.get(row.channelId)
        return {
          channel: channel?.kind === 'dm' ? 'Direct message' : (channel?.name ?? 'unknown'),
          mentions: row.mentionCount,
          mentionsOverflow: row.mentionsOverflow
        }
      })
    )
  }
})

/** `list_events` — upcoming events in a workspace (id + times + attendee counts). */
export const eventsFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, slug, limit }) => {
    const resolved = await resolveMember(ctx, userId, slug)
    if (!resolved) return []
    const now = Date.now()
    const span = 30 * 24 * 60 * 60 * 1000
    const take = Math.min(Math.max(limit ?? 20, 1), 100)
    const rows = await ctx.db
      .query('events')
      .withIndex('by_workspace_start', (q) =>
        q.eq('workspaceId', resolved.workspaceId).gte('startAt', now - span)
      )
      .take(500)
    const live = rows
      .filter((r) => r.endAt >= now)
      .sort((a, b) => a.startAt - b.startAt)
      .slice(0, take)
    return live.map((r) => ({
      id: r._id,
      title: r.title,
      start: new Date(r.startAt).toISOString(),
      end: new Date(r.endAt).toISOString(),
      allDay: r.allDay ?? false,
      location: r.location,
      timezone: r.timezone
    }))
  }
})

/** `get_board` — a kanban board's columns (in order) and their tasks (with ids). */
export const boardFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string(), channel: v.string() },
  handler: async (ctx, { userId, slug, channel: channelName }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved || resolved.channel.kind !== 'kanban') return null
    const columns = await ctx.db
      .query('kanbanColumns')
      .withIndex('by_channel', (q) => q.eq('channelId', resolved.channel._id))
      .take(MAX_COLUMNS)
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_channel', (q) => q.eq('channelId', resolved.channel._id))
      .take(MAX_TASKS)
    tasks.sort((a, b) => a.order - b.order)
    return {
      channel: resolved.channel.name,
      columns: columns
        .sort((a, b) => a.order - b.order)
        .map((column) => ({
          id: column._id,
          title: column.title,
          tasks: tasks
            .filter((t) => t.columnId === column._id)
            .map((t) => ({
              id: t._id,
              title: t.title,
              description: t.description,
              priority: t.priority,
              dueDate: t.dueDate,
              labels: t.labels,
              done: t.checklist.length > 0 && t.checklist.every((i) => i.completed)
            }))
        }))
    }
  }
})

/** `get_page` — a page channel's title and its text (a plain-text rendering of the document). */
export const pageFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string(), channel: v.string() },
  handler: async (ctx, { userId, slug, channel: channelName }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved || resolved.channel.kind !== 'page') return null
    const page = await ctx.db
      .query('pages')
      .withIndex('by_channel', (q) => q.eq('channelId', resolved.channel._id))
      .unique()
    return {
      channel: resolved.channel.name,
      title: page?.title ?? resolved.channel.name,
      text: page ? blocksToText(page.content) : ''
    }
  }
})

/** How long after its last heartbeat a voice participant is still considered present — mirrors
 *  `voice.ts` `PRESENCE_TTL_MS` (a missed beat shouldn't drop someone from the call). */
const VOICE_PRESENCE_TTL = 45_000

/** `get_voice` — who is currently in a voice channel's call, with their in-call state. Read-only:
 *  joining a call is a live WebRTC action, not an API operation. */
export const voiceFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string(), channel: v.string() },
  handler: async (ctx, { userId, slug, channel: channelName }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved || resolved.channel.kind !== 'voice') return null
    const now = Date.now()
    const rows = await ctx.db
      .query('voicePresence')
      .withIndex('by_channel', (q) => q.eq('channelId', resolved.channel._id))
      .take(200)
    const fresh = rows.filter((r) => now - r.updatedAt < VOICE_PRESENCE_TTL)
    const people = await resolveAuthors(
      ctx,
      resolved.workspaceId,
      fresh.map((r) => r.userId)
    )
    return {
      channel: resolved.channel.name,
      participants: fresh.map((r) => ({
        id: r.userId,
        name: people.get(r.userId)?.name ?? 'Unknown',
        muted: r.muted ?? false,
        deafened: r.deafened ?? false,
        videoOn: r.videoOn ?? false,
        screenSharing: r.screenSharing ?? false
      }))
    }
  }
})

/** `get_whiteboard` — a whiteboard channel's scene: the Excalidraw element JSON + count. Read-only:
 *  a diagram is drawn in the app, not authored as JSON over the API. */
export const whiteboardFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string(), channel: v.string() },
  handler: async (ctx, { userId, slug, channel: channelName }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved || resolved.channel.kind !== 'whiteboard') return null
    const board = await ctx.db
      .query('whiteboards')
      .withIndex('by_channel', (q) => q.eq('channelId', resolved.channel._id))
      .unique()
    return {
      channel: resolved.channel.name,
      elementCount: board?.elementCount ?? 0,
      // Excalidraw's own element-array format; empty when nothing has been drawn.
      elements: board?.elements ?? '[]'
    }
  }
})

// ===========================================================================
// WRITES — each acts AS the actor, gated exactly like the app's own mutations
// ===========================================================================

/** Spend one unit of the shared per-actor **API write** budget (see `rateLimiter.ts`).
 *  `callTool` runs this before every write tool, so an automation can't hammer
 *  creates/edits/deletes and pile up rows or channels. Kept as its own mutation so the
 *  dispatch has ONE drift-proof place to enforce it — a new write tool inherits the limit
 *  automatically (it's gated by the tool's `readOnlyHint`, not a per-handler call).
 *  `post_message` additionally keeps its tighter `sendMessage` limit on top. */
export const spendWriteBudget = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    await rateLimiter.limit(ctx, 'apiWrite', { key: userId, throws: true })
  }
})

/** `post_message` — post a plain-text message to a channel, as the actor. */
export const postMessageFor = internalMutation({
  args: { userId: v.id('users'), slug: v.string(), channel: v.string(), body: v.string() },
  handler: async (ctx, { userId, slug, channel: channelName, body }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved) throw new ConvexError(`No channel "${channelName}" you can see in "${slug}"`)
    const { channel } = resolved
    if (channel.kind !== 'chat') throw new ConvexError('That channel does not hold messages')
    const access = await getChannelAccess(ctx, channel._id, userId)
    if (!access) throw new ConvexError('You do not have access to this channel')
    if (!access.canPost) throw new ConvexError('This channel is read-only for you')
    const trimmed = body.trim()
    if (!trimmed) throw new ConvexError('Cannot post an empty message')
    await rateLimiter.limit(ctx, 'sendMessage', { key: userId, throws: true })
    const id = await postMessageInChannel(ctx, userId, channel, access.accessWorkspaceId, trimmed)
    return { id, channel: channel.name, posted: true }
  }
})

/** `edit_message` — edit a message the actor authored. */
export const editMessageFor = internalMutation({
  args: { userId: v.id('users'), message: v.string(), body: v.string() },
  handler: async (ctx, { userId, message: messageStr, body }) => {
    const { message } = await requireMessage(ctx, userId, messageStr)
    if (message.authorId !== userId) throw new ConvexError('You can only edit your own messages')
    const trimmed = body.trim()
    if (!trimmed) throw new ConvexError('Message cannot be empty')
    await ctx.db.patch(message._id, { body: trimmed, editedAt: Date.now() })
    return { id: message._id, edited: true }
  }
})

/** `delete_message` — delete a message the actor authored, or any if they moderate. Refuses a
 *  thread root (delete the thread in-app first), mirroring `messages.remove`'s simplest path. */
export const deleteMessageFor = internalMutation({
  args: { userId: v.id('users'), message: v.string() },
  handler: async (ctx, { userId, message: messageStr }) => {
    const { message, canModerate } = await requireMessage(ctx, userId, messageStr)
    if (message.authorId !== userId && !canModerate) {
      throw new ConvexError("You don't have permission to delete this message")
    }
    if (message.threadRootId) {
      throw new ConvexError('This message starts a thread — delete the thread in the app first')
    }
    const reactions = await ctx.db
      .query('messageReactions')
      .withIndex('by_message', (q) => q.eq('messageId', message._id))
      .collect()
    for (const reaction of reactions) await ctx.db.delete(reaction._id)
    await removeNotificationsForMessage(ctx, message._id)
    await ctx.db.delete(message._id)
    return { id: message._id, deleted: true }
  }
})

/** `react_message` — toggle an emoji reaction on a message, as the actor. */
export const reactMessageFor = internalMutation({
  args: { userId: v.id('users'), message: v.string(), emoji: v.string() },
  handler: async (ctx, { userId, message: messageStr, emoji }) => {
    const clean = emoji.trim()
    if (!clean || clean.length > 32) throw new ConvexError('Invalid emoji')
    const { message } = await requireMessage(ctx, userId, messageStr)
    const existing = await ctx.db
      .query('messageReactions')
      .withIndex('by_message_user_emoji', (q) =>
        q.eq('messageId', message._id).eq('userId', userId).eq('emoji', clean)
      )
      .unique()
    const rows = await ctx.db
      .query('messageReactions')
      .withIndex('by_message', (q) => q.eq('messageId', message._id))
      .collect()
    const summary = message.reactions ?? summarizeReactionRows(rows)
    if (existing) {
      await ctx.db.delete(existing._id)
      await ctx.db.patch(message._id, {
        reactions: applyReaction(summary, clean, userId, 'remove')
      })
      return { id: message._id, reacted: false }
    }
    await ctx.db.insert('messageReactions', { messageId: message._id, userId, emoji: clean })
    await ctx.db.patch(message._id, { reactions: applyReaction(summary, clean, userId, 'add') })
    return { id: message._id, reacted: true }
  }
})

/** `mark_read` — clear unread on a channel, as the actor. Idempotent. */
export const markReadFor = internalMutation({
  args: { userId: v.id('users'), slug: v.string(), channel: v.string() },
  handler: async (ctx, { userId, slug, channel: channelName }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved) throw new ConvexError(`No channel "${channelName}" you can see in "${slug}"`)
    const access = await getChannelAccess(ctx, resolved.channel._id, userId)
    if (!access) throw new ConvexError('You do not have access to this channel')
    const upTo = (await watermarks(ctx, [resolved.channel])).get(resolved.channel._id) ?? Date.now()
    await markChannelRead(ctx, userId, resolved.channel, upTo, access.accessWorkspaceId)
    return { channel: resolved.channel.name, marked: true }
  }
})

const CREATABLE_KINDS = new Set([
  'chat',
  'voice',
  'page',
  'kanban',
  'whiteboard',
  'database',
  'form'
])

/** `create_channel` — create a channel in a workspace, as the actor (never a guest). */
export const createChannelFor = internalMutation({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    name: v.string(),
    kind: v.string(),
    private: v.optional(v.boolean())
  },
  handler: async (ctx, { userId, slug, name, kind, private: isPrivate }) => {
    const resolved = await resolveMember(ctx, userId, slug)
    if (!resolved) throw new ConvexError(`Workspace "${slug}" not found or you are not a member`)
    if (resolved.membership.role === 'guest') throw new ConvexError('Guests cannot create channels')
    if (!CREATABLE_KINDS.has(kind)) {
      throw new ConvexError('kind must be chat, voice, page, kanban, whiteboard, database or form')
    }
    const clean = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!clean) throw new ConvexError('Channel name is required')
    const existing = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', resolved.workspaceId))
      .collect()
    const taken = new Set(existing.map((c) => c.name))
    let unique = ['g', 't', 'c'].includes(clean) ? `${clean}-channel` : clean
    if (taken.has(unique)) {
      let n = 2
      while (taken.has(`${unique}-${n}`)) n++
      unique = `${unique}-${n}`
    }
    const visibility = isPrivate ? 'private' : undefined
    const channelId = await ctx.db.insert('channels', {
      workspaceId: resolved.workspaceId,
      name: unique,
      kind: kind as Doc<'channels'>['kind'],
      visibility,
      order: existing.length,
      createdBy: userId
    })
    if (visibility === 'private') {
      await ctx.db.insert('channelMembers', {
        channelId,
        workspaceId: resolved.workspaceId,
        userId,
        addedBy: userId,
        addedAt: Date.now()
      })
    }
    // Seed the new channel the same way the in-app `channels.create` does, so an API/bot/MCP
    // caller gets a working board/table/form rather than an empty, half-initialised channel.
    if (kind === 'kanban') {
      await seedBoardColumns(ctx, { workspaceId: resolved.workspaceId, channelId, userId })
    } else if (kind === 'database') {
      await seedDatabase(ctx, { channelId })
    } else if (kind === 'form') {
      await seedForm(ctx, { workspaceId: resolved.workspaceId, channelId, title: unique })
    }
    return { id: channelId, name: unique, kind }
  }
})

/** `create_event` — add a calendar event to the workspace, as the actor (any member). */
export const createEventFor = internalMutation({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    title: v.string(),
    start: v.string(),
    end: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    allDay: v.optional(v.boolean()),
    channel: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const resolved = await resolveMember(ctx, args.userId, args.slug)
    if (!resolved)
      throw new ConvexError(`Workspace "${args.slug}" not found or you are not a member`)
    const workspace = await ctx.db.get(resolved.workspaceId)
    if (!workspace) throw new ConvexError('Workspace not found')
    const title = args.title.trim()
    if (!title) throw new ConvexError('An event needs a title')
    const startAt = Date.parse(args.start)
    if (Number.isNaN(startAt)) throw new ConvexError('start must be an ISO date-time')
    const endAt = args.end ? Date.parse(args.end) : startAt + 60 * 60 * 1000
    if (Number.isNaN(endAt)) throw new ConvexError('end must be an ISO date-time')
    if (endAt < startAt) throw new ConvexError('end must be after start')

    let channelId: Id<'channels'> | undefined
    if (args.channel) {
      const ch = await resolveVisibleChannel(ctx, args.userId, args.slug, args.channel)
      if (!ch || ch.channel.kind === 'dm' || ch.channel.visibility === 'private') {
        throw new ConvexError(`No public channel "${args.channel}" to attach the event to`)
      }
      channelId = ch.channel._id
    }

    const now = Date.now()
    const eventId = await ctx.db.insert('events', {
      workspaceId: resolved.workspaceId,
      title,
      description: args.description?.trim() || undefined,
      location: args.location?.trim() || undefined,
      startAt,
      endAt,
      allDay: args.allDay,
      timezone: workspace.timezone ?? 'UTC',
      channelId,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now
    })
    // The organiser is going — they scheduled it.
    await ctx.db.insert('eventAttendees', {
      eventId,
      workspaceId: resolved.workspaceId,
      userId: args.userId,
      status: 'going',
      updatedAt: now
    })
    return { id: eventId, title, start: new Date(startAt).toISOString(), created: true }
  }
})

/** `update_event` — change an event, organiser only. */
export const updateEventFor = internalMutation({
  args: {
    userId: v.id('users'),
    event: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    start: v.optional(v.string()),
    end: v.optional(v.string()),
    allDay: v.optional(v.boolean())
  },
  handler: async (ctx, args) => {
    const event = await requireEvent(ctx, args.userId, args.event)
    if (event.createdBy !== args.userId) {
      throw new ConvexError('Only the organiser can change this event')
    }
    const startAt = args.start ? Date.parse(args.start) : event.startAt
    const endAt = args.end ? Date.parse(args.end) : event.endAt
    if (Number.isNaN(startAt) || Number.isNaN(endAt)) throw new ConvexError('Invalid date-time')
    if (endAt < startAt) throw new ConvexError('end must be after start')
    const title = (args.title ?? event.title).trim()
    if (!title) throw new ConvexError('An event needs a title')
    await ctx.db.patch(event._id, {
      title,
      description:
        args.description !== undefined ? args.description.trim() || undefined : event.description,
      location: args.location !== undefined ? args.location.trim() || undefined : event.location,
      startAt,
      endAt,
      allDay: args.allDay ?? event.allDay,
      updatedAt: Date.now()
    })
    return { id: event._id, updated: true }
  }
})

/** `delete_event` — delete an event + its RSVPs, organiser only. */
export const deleteEventFor = internalMutation({
  args: { userId: v.id('users'), event: v.string() },
  handler: async (ctx, { userId, event: eventStr }) => {
    const event = await requireEvent(ctx, userId, eventStr)
    if (event.createdBy !== userId)
      throw new ConvexError('Only the organiser can delete this event')
    const attendees = await ctx.db
      .query('eventAttendees')
      .withIndex('by_event', (q) => q.eq('eventId', event._id))
      .take(200)
    for (const row of attendees) await ctx.db.delete(row._id)
    await ctx.db.delete(event._id)
    return { id: event._id, deleted: true }
  }
})

/** `rsvp_event` — set the actor's RSVP (going / maybe / declined / invited). Upsert. */
export const rsvpEventFor = internalMutation({
  args: { userId: v.id('users'), event: v.string(), status: rsvpStatus },
  handler: async (ctx, { userId, event: eventStr, status }) => {
    const event = await requireEvent(ctx, userId, eventStr)
    const existing = await ctx.db
      .query('eventAttendees')
      .withIndex('by_event_user', (q) => q.eq('eventId', event._id).eq('userId', userId))
      .unique()
    const now = Date.now()
    if (existing) {
      if (existing.status !== status) await ctx.db.patch(existing._id, { status, updatedAt: now })
    } else {
      await ctx.db.insert('eventAttendees', {
        eventId: event._id,
        workspaceId: event.workspaceId,
        userId,
        status,
        updatedAt: now
      })
    }
    return { id: event._id, status }
  }
})

/** `create_task` — add a task (ticket) to a board column, as the actor. */
export const createTaskFor = internalMutation({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    channel: v.string(),
    column: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(taskPriority),
    dueDate: v.optional(v.string()),
    labels: v.optional(v.array(v.string()))
  },
  handler: async (ctx, args) => {
    const channel = await requireBoardChannel(ctx, args.userId, args.slug, args.channel)
    const column = await resolveColumn(ctx, channel, args.column)
    if (!column) throw new ConvexError(`No column "${args.column}" on this board`)
    const title = args.title.trim().slice(0, MAX_TITLE)
    if (!title) throw new ConvexError('A task needs a title')
    const labels = (args.labels ?? []).slice(0, MAX_LABELS)
    const siblings = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_column_order', (q) => q.eq('columnId', column._id))
      .take(MAX_TASKS + 1)
    if (siblings.length >= MAX_TASKS) throw new ConvexError('This board is full')
    const now = Date.now()
    const id = await ctx.db.insert('kanbanTasks', {
      workspaceId: channel.workspaceId,
      channelId: channel._id,
      columnId: column._id,
      title,
      description: args.description?.trim() || undefined,
      priority: args.priority ?? 'medium',
      assigneeIds: [],
      labels,
      checklist: [],
      dueDate: args.dueDate,
      order: siblings.length,
      createdBy: args.userId,
      createdAt: now,
      updatedAt: now
    })
    return { id, title, column: column.title }
  }
})

/** `update_task` — change a task's fields (any member of its workspace). Only the fields you
 *  pass change. */
export const updateTaskFor = internalMutation({
  args: {
    userId: v.id('users'),
    task: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(taskPriority),
    dueDate: v.optional(v.union(v.string(), v.null())),
    labels: v.optional(v.array(v.string()))
  },
  handler: async (ctx, args) => {
    const task = await requireTask(ctx, args.userId, args.task)
    const patch: Partial<Doc<'kanbanTasks'>> = { updatedAt: Date.now() }
    if (args.title !== undefined) {
      const title = args.title.trim().slice(0, MAX_TITLE)
      if (!title) throw new ConvexError('A task needs a title')
      patch.title = title
    }
    if (args.description !== undefined) patch.description = args.description.trim() || undefined
    if (args.priority !== undefined) patch.priority = args.priority
    if (args.dueDate !== undefined) patch.dueDate = args.dueDate ?? undefined
    if (args.labels !== undefined) patch.labels = args.labels.slice(0, MAX_LABELS)
    await ctx.db.patch(task._id, patch)
    return { id: task._id, updated: true }
  }
})

/** `move_task` — move a task to another column (and optional position), as the actor. */
export const moveTaskFor = internalMutation({
  args: {
    userId: v.id('users'),
    task: v.string(),
    column: v.string(),
    position: v.optional(v.number())
  },
  handler: async (ctx, { userId, task: taskStr, column: columnRef, position }) => {
    const task = await requireTask(ctx, userId, taskStr)
    const channel = await ctx.db.get(task.channelId)
    if (!channel) throw new ConvexError('Board not found')
    // Accept the target column by id OR title, scoped to this task's board (so a title from a
    // different board can't collide) — the same friendly resolution as create_task.
    const target = await resolveColumn(ctx, channel, columnRef)
    if (!target) throw new ConvexError(`No column "${columnRef}" on this board`)
    // Renumber the target column: pull its current tasks (excluding this one), splice ours in.
    const siblings = (
      await ctx.db
        .query('kanbanTasks')
        .withIndex('by_column_order', (q) => q.eq('columnId', target._id))
        .take(MAX_TASKS)
    )
      .filter((t) => t._id !== task._id)
      .sort((a, b) => a.order - b.order)
    const at = Math.min(Math.max(position ?? siblings.length, 0), siblings.length)
    siblings.splice(at, 0, task)
    for (let i = 0; i < siblings.length; i++) {
      await ctx.db.patch(siblings[i]._id, { columnId: target._id, order: i, updatedAt: Date.now() })
    }
    return { id: task._id, column: target.title, position: at }
  }
})

/** `delete_task` — delete a task (any member of its workspace). */
export const deleteTaskFor = internalMutation({
  args: { userId: v.id('users'), task: v.string() },
  handler: async (ctx, { userId, task: taskStr }) => {
    const task = await requireTask(ctx, userId, taskStr)
    await ctx.db.delete(task._id)
    return { id: task._id, deleted: true }
  }
})

/** `create_column` — add a column to a board, as the actor. */
export const createColumnFor = internalMutation({
  args: { userId: v.id('users'), slug: v.string(), channel: v.string(), title: v.string() },
  handler: async (ctx, { userId, slug, channel: channelName, title }) => {
    const channel = await requireBoardChannel(ctx, userId, slug, channelName)
    const clean = title.trim().slice(0, MAX_TITLE)
    if (!clean) throw new ConvexError('A column needs a name')
    const existing = await ctx.db
      .query('kanbanColumns')
      .withIndex('by_channel', (q) => q.eq('channelId', channel._id))
      .take(MAX_COLUMNS + 1)
    if (existing.length >= MAX_COLUMNS) {
      throw new ConvexError(`A board can have at most ${MAX_COLUMNS} columns`)
    }
    const id = await ctx.db.insert('kanbanColumns', {
      workspaceId: channel.workspaceId,
      channelId: channel._id,
      title: clean,
      order: existing.length,
      createdBy: userId
    })
    return { id, title: clean }
  }
})

/** `rename_column` — rename a board column, as the actor. */
export const renameColumnFor = internalMutation({
  args: { userId: v.id('users'), column: v.string(), title: v.string() },
  handler: async (ctx, { userId, column: columnStr, title }) => {
    const column = await requireColumn(ctx, userId, columnStr)
    const clean = title.trim().slice(0, MAX_TITLE)
    if (!clean) throw new ConvexError('A column needs a name')
    await ctx.db.patch(column._id, { title: clean })
    return { id: column._id, title: clean }
  }
})

/** `delete_column` — delete a board column AND its tasks, as the actor. */
export const deleteColumnFor = internalMutation({
  args: { userId: v.id('users'), column: v.string() },
  handler: async (ctx, { userId, column: columnStr }) => {
    const column = await requireColumn(ctx, userId, columnStr)
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_column_order', (q) => q.eq('columnId', column._id))
      .take(MAX_TASKS)
    for (const task of tasks) await ctx.db.delete(task._id)
    await ctx.db.delete(column._id)
    return { id: column._id, deleted: true }
  }
})

/** `set_page` — set a page channel's title and/or its text (plain text → paragraphs). Rich
 *  formatting is edited in the app; the API writes plain paragraphs, which the editor then
 *  opens and the owner can format. */
export const setPageFor = internalMutation({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    channel: v.string(),
    title: v.optional(v.string()),
    text: v.optional(v.string())
  },
  handler: async (ctx, { userId, slug, channel: channelName, title, text }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved) throw new ConvexError(`No channel "${channelName}" you can see in "${slug}"`)
    const channel = resolved.channel
    if (channel.kind !== 'page') throw new ConvexError('That channel is not a page')
    const page = await ctx.db
      .query('pages')
      .withIndex('by_channel', (q) => q.eq('channelId', channel._id))
      .unique()
    const now = Date.now()
    const patch: Partial<Doc<'pages'>> = { updatedAt: now, updatedBy: userId }
    if (title !== undefined) patch.title = title.trim().slice(0, 120)
    if (text !== undefined) patch.content = textToBlocks(text)
    if (page) {
      await ctx.db.patch(page._id, patch)
      return { channel: channel.name, updated: true }
    }
    await ctx.db.insert('pages', {
      workspaceId: channel.workspaceId,
      channelId: channel._id,
      title: patch.title ?? channel.name,
      content: patch.content ?? '[]',
      updatedAt: now,
      updatedBy: userId
    })
    return { channel: channel.name, created: true }
  }
})

// ===========================================================================
// DATABASE + FORM channels
// ===========================================================================

const MAX_DB_RECORDS_API = 500
const MAX_FORM_RESPONSES_API = 500
/** One cell / response value — the same primitive shapes the schema stores. */
const apiCellValue = v.union(v.string(), v.number(), v.boolean(), v.array(v.string()), v.null())

/** Resolve a `database` channel the actor can see, by (slug, channel name). */
async function requireDatabaseChannel(
  ctx: ReaderCtx,
  userId: Id<'users'>,
  slug: string,
  channelName: string
): Promise<Doc<'channels'>> {
  const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
  if (!resolved) throw new ConvexError(`No channel "${channelName}" you can see in "${slug}"`)
  if (resolved.channel.kind !== 'database') throw new ConvexError('That channel is not a database')
  return resolved.channel
}

/** Resolve a database record by id, checking channel access. */
async function requireRecord(
  ctx: ReaderCtx,
  userId: Id<'users'>,
  recordStr: string
): Promise<Doc<'databaseRecords'>> {
  const id = ctx.db.normalizeId('databaseRecords', recordStr)
  if (!id) throw new ConvexError('Unknown record id')
  const record = await ctx.db.get(id)
  if (!record) throw new ConvexError('Record not found')
  await requireChannelAccess(ctx, record.channelId, userId)
  return record
}

/** `get_database` — a database channel's fields (with ids + types) and its records (with ids +
 *  values), so a write tool can reference them. */
export const databaseFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string(), channel: v.string() },
  handler: async (ctx, { userId, slug, channel: channelName }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved || resolved.channel.kind !== 'database') return null
    const [fields, records] = await Promise.all([
      ctx.db
        .query('databaseFields')
        .withIndex('by_channel', (q) => q.eq('channelId', resolved.channel._id))
        .collect(),
      ctx.db
        .query('databaseRecords')
        .withIndex('by_channel_order', (q) => q.eq('channelId', resolved.channel._id))
        .take(MAX_DB_RECORDS_API)
    ])
    return {
      channel: resolved.channel.name,
      fields: fields
        .sort((a, b) => a.order - b.order)
        .map((f) => ({
          id: f._id,
          name: f.name,
          type: f.type,
          options: f.options?.map((o) => ({ id: o.id, label: o.label }))
        })),
      records: records.map((r) => ({ id: r._id, values: r.values }))
    }
  }
})

/** `create_record` — add a record to a database, as the actor. `values` is keyed by field id. */
export const createRecordFor = internalMutation({
  args: {
    userId: v.id('users'),
    slug: v.string(),
    channel: v.string(),
    values: v.optional(v.record(v.string(), apiCellValue))
  },
  handler: async (ctx, { userId, slug, channel: channelName, values }) => {
    const channel = await requireDatabaseChannel(ctx, userId, slug, channelName)
    const count = (
      await ctx.db
        .query('databaseRecords')
        .withIndex('by_channel_order', (q) => q.eq('channelId', channel._id))
        .take(MAX_DB_RECORDS_API)
    ).length
    if (count >= MAX_DB_RECORDS_API) throw new ConvexError('This table is full')
    const id = await ctx.db.insert('databaseRecords', {
      channelId: channel._id,
      values: values ?? {},
      order: count,
      createdBy: userId,
      createdAt: Date.now()
    })
    return { id, created: true }
  }
})

/** `update_record` — merge new cell values into a record. Only the fields you pass change; a
 *  null/empty value clears that cell. */
export const updateRecordFor = internalMutation({
  args: {
    userId: v.id('users'),
    record: v.string(),
    values: v.record(v.string(), apiCellValue)
  },
  handler: async (ctx, { userId, record: recordStr, values }) => {
    const record = await requireRecord(ctx, userId, recordStr)
    const next = { ...record.values }
    for (const [fieldId, value] of Object.entries(values)) {
      if (value === null || value === '') delete next[fieldId]
      else next[fieldId] = value
    }
    await ctx.db.patch(record._id, { values: next })
    return { id: record._id, updated: true }
  }
})

/** `delete_record` — remove a database record. Irreversible. */
export const deleteRecordFor = internalMutation({
  args: { userId: v.id('users'), record: v.string() },
  handler: async (ctx, { userId, record: recordStr }) => {
    const record = await requireRecord(ctx, userId, recordStr)
    await ctx.db.delete(record._id)
    return { id: record._id, deleted: true }
  }
})

/** `get_form` — a form channel's schema (title + fields) and its response count. */
export const formSchemaFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string(), channel: v.string() },
  handler: async (ctx, { userId, slug, channel: channelName }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved || resolved.channel.kind !== 'form') return null
    const form = await ctx.db
      .query('forms')
      .withIndex('by_channel', (q) => q.eq('channelId', resolved.channel._id))
      .unique()
    if (!form) return null
    const responses = await ctx.db
      .query('formResponses')
      .withIndex('by_form', (q) => q.eq('formId', form._id))
      .take(MAX_FORM_RESPONSES_API)
    return {
      channel: resolved.channel.name,
      title: form.title,
      description: form.description,
      fields: form.fields.map((f) => ({ id: f.id, name: f.name, type: f.type, required: f.required })),
      responseCount: responses.length
    }
  }
})

/** `list_responses` — a form channel's submissions (id, timestamp, values). */
export const formResponsesFor = internalQuery({
  args: { userId: v.id('users'), slug: v.string(), channel: v.string() },
  handler: async (ctx, { userId, slug, channel: channelName }) => {
    const resolved = await resolveVisibleChannel(ctx, userId, slug, channelName)
    if (!resolved || resolved.channel.kind !== 'form') return []
    const form = await ctx.db
      .query('forms')
      .withIndex('by_channel', (q) => q.eq('channelId', resolved.channel._id))
      .unique()
    if (!form) return []
    const responses = await ctx.db
      .query('formResponses')
      .withIndex('by_form', (q) => q.eq('formId', form._id))
      .order('desc')
      .take(MAX_FORM_RESPONSES_API)
    return responses.map((r) => ({
      id: r._id,
      submittedAt: r.submittedAt,
      values: r.values
    }))
  }
})

// ---------------------------------------------------------------------------
// Plain-text ⇄ BlockNote document (the page content is a BlockNote block array as JSON)
// ---------------------------------------------------------------------------

/** Each non-empty line becomes a paragraph block; blank lines become empty paragraphs. Ids are
 *  index-derived (deterministic — no `Math.random`, which Convex forbids). BlockNote normalises
 *  anything else on load, and `parsePageContent` opens an unparseable doc empty, so this is
 *  low-risk. */
function textToBlocks(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks = lines.map((line, i) => ({
    id: `api-${i}`,
    type: 'paragraph',
    props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
    content: line ? [{ type: 'text', text: line, styles: {} }] : [],
    children: []
  }))
  if (blocks.length === 0) {
    blocks.push({
      id: 'api-0',
      type: 'paragraph',
      props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
      content: [],
      children: []
    })
  }
  return JSON.stringify(blocks)
}

/** Render a stored BlockNote document back to plain text — the inverse of `textToBlocks`, best
 *  effort (walks each block's inline text runs). A corrupt document yields ''. */
function blocksToText(content: string): string {
  try {
    const blocks = JSON.parse(content) as Array<{ content?: Array<{ text?: string }> }>
    if (!Array.isArray(blocks)) return ''
    return blocks
      .map((block) =>
        Array.isArray(block.content)
          ? block.content.map((run) => (typeof run.text === 'string' ? run.text : '')).join('')
          : ''
      )
      .join('\n')
      .trim()
  } catch {
    return ''
  }
}
