import { ConvexError, v } from 'convex/values'
import { query, mutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { getChannelAccess, getCurrentUser, requireChannelAccess, requireUser } from './lib/auth'
import { markUploadUsed, objectUrl, r2 } from './files'

/**
 * The Notion-style block document behind a `kind: 'doc'` channel — one `channelDocs` row
 * per channel, created by the first real edit. Same shape as `whiteboards.ts`, and for the
 * same reasons.
 *
 * `content` is the TipTap/ProseMirror document stringified. It is opaque here: the node
 * vocabulary belongs to the editor, so the server validates its SIZE and never its shape.
 *
 * Content and chrome (title / icon / cover) are separate mutations on purpose — a keystroke
 * in the title must not ship the whole document, and a keystroke in the body must not
 * re-write the cover.
 */

/** A ProseMirror document with images, tables and an inline whiteboard can get large;
 *  refuse an absurd payload with a message the user can act on, rather than failing
 *  opaquely at Convex's document-size limit. */
const MAX_CONTENT_BYTES = 900 * 1024
const MAX_TITLE = 200
const MAX_ICON = 32

/**
 * The empty document. **Every stub row a mutation writes must use this**, and it must be a
 * value the client's `parseDocContent` accepts — a sentinel the reader rejects makes the
 * editor open blank against a row that exists, and the first normalisation `update` then
 * saves that blank over the user's text. (That is not hypothetical: writing a BlockNote-era
 * `'[]'` here caused exactly that data loss. See `components/doc/doc-extensions.ts`.)
 */
const EMPTY_DOC = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })

/**
 * A cover is one of `gradient:<key>`, `color:<#hex>`, or a direct image URL — validated
 * SERVER-side because the value lands in a CSS `url()` on every reader's screen. Without
 * this a crafted `javascript:`/`data:` string would be stored and replayed to everyone with
 * access; the client's own encoding is a convenience, not a boundary.
 */
function validateCover(cover: string): void {
  if (cover.startsWith('gradient:')) {
    if (!/^gradient:[a-z]+$/.test(cover)) throw new ConvexError('Invalid cover gradient')
    return
  }
  if (cover.startsWith('color:')) {
    if (!/^color:#[0-9a-fA-F]{3,8}$/.test(cover)) throw new ConvexError('Invalid cover colour')
    return
  }
  if (!/^https?:\/\//i.test(cover)) throw new ConvexError('A cover image must be an http(s) URL')
  if (cover.length > 2048) throw new ConvexError('That cover URL is too long')
}

/** Best-effort delete of an uploaded cover object — an orphan is wasted bytes, not a
 *  failed mutation. */
async function deleteCoverObject(ctx: MutationCtx, key: string | undefined): Promise<void> {
  if (!key) return
  try {
    await r2.deleteObject(ctx, key)
  } catch {
    // ignore
  }
}

/** The channel + its doc row, gated on write access. `requireChannelAccess` enforces
 *  private-channel MEMBERSHIP (an admin outside a private doc channel can't touch it) and
 *  `canPost` enforces the posting policy — a read-only doc channel is one nobody but
 *  owner/admins can edit, exactly as a read-only chat channel is one nobody can post in. */
async function requireDocWrite(
  ctx: MutationCtx,
  channelId: Id<'channels'>
): Promise<{ channel: Doc<'channels'>; doc: Doc<'channelDocs'> | null; userId: Id<'users'> }> {
  const user = await requireUser(ctx)
  const { channel, canPost } = await requireChannelAccess(ctx, channelId, user._id)
  if (channel.kind !== 'doc') throw new ConvexError('That channel is not a doc')
  if (!canPost) throw new ConvexError("You don't have permission to edit this doc")
  const doc = await ctx.db
    .query('channelDocs')
    .withIndex('by_channel', (q) => q.eq('channelId', channelId))
    .unique()
  return { channel, doc, userId: user._id }
}

/**
 * The doc's content + chrome, plus whether the caller may edit it.
 *
 * `content: null` means nothing has been written yet — the editor opens empty and the first
 * real edit creates the row. Null-safe (returns `null` rather than throwing) so the
 * first-login race can't blow up the view.
 */
export const getByChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null
    // Membership decides content access, not role — the same chokepoint chat goes through.
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access) return null

    const doc = await ctx.db
      .query('channelDocs')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .unique()

    return {
      content: doc?.content ?? null,
      title: doc?.title ?? null,
      icon: doc?.icon ?? null,
      cover: doc?.cover ?? null,
      coverY: doc?.coverY ?? null,
      canWrite: access.canPost
    }
  }
})

/** Autosaved by the editor, debounced. Upserts — the row is born from the first real edit,
 *  so an untouched doc channel costs nothing. */
export const save = mutation({
  args: { channelId: v.id('channels'), content: v.string() },
  handler: async (ctx, { channelId, content }) => {
    if (content.length > MAX_CONTENT_BYTES) {
      throw new ConvexError('This doc is too large to save')
    }
    const { channel, doc, userId } = await requireDocWrite(ctx, channelId)

    if (doc) {
      // A no-op write still bumps reactivity and re-notifies every subscriber — the same
      // trap `whiteboards.save` guards against, and it matters here too (the editor fires
      // `onUpdate` on selection-only transactions).
      if (doc.content === content) return
      await ctx.db.patch(doc._id, { content, updatedAt: Date.now(), updatedBy: userId })
      return
    }
    await ctx.db.insert('channelDocs', {
      workspaceId: channel.workspaceId,
      channelId,
      // A doc created by typing takes the channel's name as its title.
      title: channel.name,
      content,
      updatedAt: Date.now(),
      updatedBy: userId
    })
  }
})

/** The doc's chrome: title, emoji icon, cover + its focal point. Only what's passed is
 *  written; `null` clears icon/cover. Called debounced, with patches merged in the window. */
export const saveMeta = mutation({
  args: {
    channelId: v.id('channels'),
    title: v.optional(v.string()),
    icon: v.optional(v.union(v.string(), v.null())),
    cover: v.optional(v.union(v.string(), v.null())),
    coverY: v.optional(v.number())
  },
  handler: async (ctx, { channelId, title, icon, cover, coverY }) => {
    if (typeof cover === 'string') validateCover(cover)
    if (coverY !== undefined && (!Number.isFinite(coverY) || coverY < 0 || coverY > 100)) {
      throw new ConvexError('Cover position must be between 0 and 100')
    }
    const { channel, doc, userId } = await requireDocWrite(ctx, channelId)

    const patch: Partial<Doc<'channelDocs'>> = { updatedAt: Date.now(), updatedBy: userId }
    if (title !== undefined) patch.title = title.trim().slice(0, MAX_TITLE)
    // `null` means "remove it"; Convex drops a field patched with `undefined`.
    if (icon !== undefined) patch.icon = icon?.slice(0, MAX_ICON) || undefined
    if (cover !== undefined) {
      patch.cover = cover ?? undefined
      // A cover set here is a gradient/colour/Unsplash/link (or a removal), never an
      // upload — those go through `setCoverUpload`. So an uploaded cover is now orphaned.
      if (doc?.coverKey) {
        await deleteCoverObject(ctx, doc.coverKey)
        patch.coverKey = undefined
      }
    }
    if (coverY !== undefined) patch.coverY = coverY

    if (doc) {
      await ctx.db.patch(doc._id, patch)
      return
    }
    // Chrome set before anything was typed — create the row so it persists. `EMPTY_DOC`,
    // never a sentinel the editor can't parse (see its comment).
    await ctx.db.insert('channelDocs', {
      workspaceId: channel.workspaceId,
      channelId,
      title: patch.title ?? channel.name,
      icon: patch.icon,
      cover: patch.cover,
      coverY: patch.coverY,
      content: EMPTY_DOC,
      updatedAt: Date.now(),
      updatedBy: userId
    })
  }
})

/**
 * Claim an R2 upload made from inside the editor (an image / video / audio / file block)
 * and return its durable URL for the node to store.
 *
 * `markUploadUsed` is ownership-checked, which is what turns the key into a capability: a
 * member can't adopt someone else's pending upload (an R2 key is not a secret — it's
 * visible in every attachment URL).
 */
export const resolveUpload = mutation({
  args: { channelId: v.id('channels'), key: v.string() },
  handler: async (ctx, { channelId, key }): Promise<string> => {
    const { userId } = await requireDocWrite(ctx, channelId)
    await markUploadUsed(ctx, userId, key)
    return await objectUrl(key)
  }
})

/** Adopt an R2-uploaded image as the doc's cover. Separate from `saveMeta` because the
 *  upload has to be claimed AND the previous cover object reclaimed in the same
 *  transaction — a plain meta save would treat the URL as a link and never free the old
 *  object. Returns the URL so the client can paint it immediately. */
export const setCoverUpload = mutation({
  args: { channelId: v.id('channels'), key: v.string() },
  handler: async (ctx, { channelId, key }): Promise<string> => {
    const { channel, doc, userId } = await requireDocWrite(ctx, channelId)
    await markUploadUsed(ctx, userId, key)
    const url = await objectUrl(key)

    if (doc) {
      const previousKey = doc.coverKey
      await ctx.db.patch(doc._id, {
        cover: url,
        coverKey: key,
        coverY: 50,
        updatedAt: Date.now(),
        updatedBy: userId
      })
      if (previousKey && previousKey !== key) await deleteCoverObject(ctx, previousKey)
    } else {
      await ctx.db.insert('channelDocs', {
        workspaceId: channel.workspaceId,
        channelId,
        title: channel.name,
        cover: url,
        coverKey: key,
        coverY: 50,
        content: EMPTY_DOC,
        updatedAt: Date.now(),
        updatedBy: userId
      })
    }
    return url
  }
})
