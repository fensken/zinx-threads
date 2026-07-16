import { ConvexError, v } from 'convex/values'
import { query, mutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'
import { markUploadUsed, objectUrl, r2 } from './files'

/** Best-effort delete of a page's uploaded cover object (a stale object is wasted
 *  storage, not a failure). */
async function deleteCoverObject(ctx: MutationCtx, key: string | undefined): Promise<void> {
  if (!key) return
  try {
    await r2.deleteObject(ctx, key)
  } catch {
    // ignore
  }
}

/** A BlockNote document can get large; refuse absurd payloads rather than letting
 *  one page blow the document size limit. */
const MAX_CONTENT_BYTES = 512 * 1024
const MAX_TITLE = 120

/** The page behind a `page` channel. `null` when nothing has been written yet —
 *  the editor then starts empty and the first save creates the row. */
export const getByChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null
    const channel = await ctx.db.get(channelId)
    if (!channel) return null
    if (!(await getMembership(ctx, channel.workspaceId, user._id))) return null

    return await ctx.db
      .query('pages')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .unique()
  }
})

/** Resolve the channel + membership, then the existing page row (if any). */
async function requirePageAccess(
  ctx: MutationCtx,
  channelId: Id<'channels'>
): Promise<{ channel: Doc<'channels'>; page: Doc<'pages'> | null; userId: Id<'users'> }> {
  const user = await requireUser(ctx)
  const channel = await ctx.db.get(channelId)
  if (!channel) throw new ConvexError('Channel not found')
  if (channel.kind !== 'page') throw new ConvexError('That channel is not a page')
  if (!(await getMembership(ctx, channel.workspaceId, user._id))) {
    throw new ConvexError('Not a member of this workspace')
  }
  const page = await ctx.db
    .query('pages')
    .withIndex('by_channel', (q) => q.eq('channelId', channelId))
    .unique()
  return { channel, page, userId: user._id }
}

/** Autosaved by the editor (debounced). Split from `saveMeta` so a keystroke in
 *  the title doesn't ship the whole document, and vice versa. */
export const saveContent = mutation({
  args: { channelId: v.id('channels'), content: v.string() },
  handler: async (ctx, { channelId, content }) => {
    if (content.length > MAX_CONTENT_BYTES) throw new ConvexError('This page is too large to save')
    const { channel, page, userId } = await requirePageAccess(ctx, channelId)

    if (page) {
      // A no-op write would still bump `updatedAt` and re-notify every subscriber.
      if (page.content === content) return
      await ctx.db.patch(page._id, { content, updatedAt: Date.now(), updatedBy: userId })
      return
    }
    await ctx.db.insert('pages', {
      workspaceId: channel.workspaceId,
      channelId,
      // A page created by typing takes the channel's name as its title.
      title: channel.name,
      content,
      updatedAt: Date.now(),
      updatedBy: userId
    })
  }
})

/** Page chrome: title, emoji icon, cover image + its focal point. Every field is
 *  optional; only what's passed is written (`null` clears icon/cover). */
export const saveMeta = mutation({
  args: {
    channelId: v.id('channels'),
    title: v.optional(v.string()),
    icon: v.optional(v.union(v.string(), v.null())),
    cover: v.optional(v.union(v.string(), v.null())),
    coverY: v.optional(v.number())
  },
  handler: async (ctx, { channelId, title, icon, cover, coverY }) => {
    const { channel, page, userId } = await requirePageAccess(ctx, channelId)

    const patch: Partial<Doc<'pages'>> = { updatedAt: Date.now(), updatedBy: userId }
    if (title !== undefined) patch.title = title.trim().slice(0, MAX_TITLE)
    // `null` means "remove it"; Convex drops a field patched with `undefined`.
    if (icon !== undefined) patch.icon = icon ?? undefined
    if (cover !== undefined) {
      patch.cover = cover ?? undefined
      // A cover set via `saveMeta` is a gradient/color/Unsplash/link (or removal),
      // never an upload — those go through `setCoverUpload`. So if the page had an
      // uploaded cover, it's now orphaned: delete the object + clear the key.
      if (page?.coverKey) {
        await deleteCoverObject(ctx, page.coverKey)
        patch.coverKey = undefined
      }
    }
    if (coverY !== undefined) patch.coverY = coverY

    if (page) {
      await ctx.db.patch(page._id, patch)
      return
    }
    await ctx.db.insert('pages', {
      workspaceId: channel.workspaceId,
      channelId,
      title: patch.title ?? channel.name,
      icon: patch.icon,
      cover: patch.cover,
      coverY: patch.coverY,
      content: '[]',
      updatedAt: Date.now(),
      updatedBy: userId
    })
  }
})

/** Set an **uploaded** cover image from a freshly-uploaded R2 object. Resolves it
 *  to a durable URL, stores `cover` + `coverKey`, deletes the previous uploaded
 *  cover, and returns the URL so the client can show it immediately. */
export const setCoverUpload = mutation({
  args: { channelId: v.id('channels'), key: v.string() },
  handler: async (ctx, { channelId, key }): Promise<string> => {
    const { channel, page, userId } = await requirePageAccess(ctx, channelId)
    await markUploadUsed(ctx, userId, key)
    const url = await objectUrl(key)

    if (page) {
      const previousKey = page.coverKey
      await ctx.db.patch(page._id, {
        cover: url,
        coverKey: key,
        updatedAt: Date.now(),
        updatedBy: userId
      })
      if (previousKey && previousKey !== key) await deleteCoverObject(ctx, previousKey)
    } else {
      await ctx.db.insert('pages', {
        workspaceId: channel.workspaceId,
        channelId,
        title: channel.name,
        cover: url,
        coverKey: key,
        content: '[]',
        updatedAt: Date.now(),
        updatedBy: userId
      })
    }
    return url
  }
})
