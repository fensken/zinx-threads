import { ConvexError, v } from 'convex/values'
import { query, mutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'

/**
 * The Excalidraw canvas behind a `kind: 'whiteboard'` channel — one row per channel,
 * created on first save. The same shape as `pages.ts`, and for the same reasons.
 *
 * This replaced an Excalidraw *block inside a page*. That was the wrong home: a page
 * autosaves its whole document on every keystroke, so an inline scene would have been
 * re-uploaded with every word typed — which forced the drawing into a separate row, and
 * the block into a click-to-open preview card with a PNG snapshot to render. A channel
 * has none of that: the canvas *is* the content, it saves on its own schedule, and the
 * card, the snapshot and the modal are all gone.
 */

/** Convex documents have a hard size limit; refuse past this with a message the user can
 *  act on rather than failing opaquely at the storage layer. */
const MAX_ELEMENTS_BYTES = 900 * 1024

/** The channel must be one the caller can see, and must actually be a whiteboard — the
 *  same kind-gate `pages.ts` and `boards.ts` apply, so a crafted call can't bury a scene
 *  in a channel no view would ever surface. */
async function requireWhiteboardChannel(
  ctx: MutationCtx,
  channelId: Id<'channels'>,
  userId: Id<'users'>
): Promise<Doc<'channels'>> {
  const channel = await ctx.db.get(channelId)
  if (!channel) throw new ConvexError('Channel not found')
  if (!(await getMembership(ctx, channel.workspaceId, userId))) {
    throw new ConvexError('Not a member of this workspace')
  }
  if (channel.kind !== 'whiteboard') throw new ConvexError('That channel is not a whiteboard')
  return channel
}

/** The channel's canvas. `null` = nothing drawn yet (no row), which the view opens as an
 *  empty board. Null-safe like every other query here. */
export const getByChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null
    const channel = await ctx.db.get(channelId)
    if (!channel) return null
    if (!(await getMembership(ctx, channel.workspaceId, user._id))) return null
    return await ctx.db
      .query('whiteboards')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .unique()
  }
})

/** Save the scene. Upserts — the row is created by the first real edit, not by opening
 *  the channel, so an untouched whiteboard costs nothing. */
export const save = mutation({
  args: {
    channelId: v.id('channels'),
    elements: v.string(),
    elementCount: v.number()
  },
  handler: async (ctx, { channelId, elements, elementCount }) => {
    const user = await requireUser(ctx)
    const channel = await requireWhiteboardChannel(ctx, channelId, user._id)
    if (elements.length > MAX_ELEMENTS_BYTES) {
      throw new ConvexError('That drawing is too large to save')
    }

    const existing = await ctx.db
      .query('whiteboards')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .unique()

    const fields = {
      elements,
      elementCount: Math.max(0, Math.floor(elementCount)),
      updatedBy: user._id,
      updatedAt: Date.now()
    }

    if (!existing) {
      await ctx.db.insert('whiteboards', {
        workspaceId: channel.workspaceId,
        channelId,
        ...fields
      })
      return
    }
    // Skip a no-op write: patching a row with the value it already has still bumps
    // reactivity and re-notifies every subscriber (the same trap `pages.saveContent`
    // guards against, and it matters more here — the canvas fires `onChange` constantly).
    if (existing.elements === elements) return
    await ctx.db.patch(existing._id, fields)
  }
})
