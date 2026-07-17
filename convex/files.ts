import { ConvexError, v } from 'convex/values'
import { R2 } from '@convex-dev/r2'
import { mutation, internalMutation, type MutationCtx } from './_generated/server'
import { components, internal } from './_generated/api'
import type { DataModel, Id } from './_generated/dataModel'
import { getCurrentUser, requireChannelAccess, requireUser } from './lib/auth'
import { rateLimiter } from './rateLimiter'

// Cloudflare R2 file uploads via the `@convex-dev/r2` component. The browser
// uploads straight to R2 with a short-lived signed URL that `generateUploadUrl`
// mints — the file bytes never pass through Convex. Credentials live in Convex
// env, never the renderer:
//   npx convex env set R2_TOKEN <token>
//   npx convex env set R2_ACCESS_KEY_ID <id>
//   npx convex env set R2_SECRET_ACCESS_KEY <secret>
//   npx convex env set R2_ENDPOINT https://<account>.r2.cloudflarestorage.com
//   npx convex env set R2_BUCKET <bucket>
//   npx convex env set R2_PUBLIC_URL https://<public-domain>   # optional, see below
// The R2 bucket also needs a CORS rule allowing PUT from the app origin — see
// SETUP.md.

export const r2 = new R2(components.r2)

// `clientApi` exposes the two mutations the browser hook (`useUploadFile`) calls:
// `generateUploadUrl` (mint the signed PUT) and `syncMetadata` (record size/type
// after the PUT lands). `checkUpload` gates who may request an upload URL — only
// signed-in users, since every upload spends our R2 quota. `onUpload` records the
// object as an *orphan candidate* until something references it (see `uploads`).
export const { generateUploadUrl, syncMetadata } = r2.clientApi<DataModel>({
  checkUpload: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) throw new ConvexError('You must be signed in to upload')
    // Every upload URL spends R2 quota, so it's rate-limited per user like the other
    // endpoints that draw on a paid resource with our keys. `check` (read-only) rather
    // than `limit` — the component hands `checkUpload` a *query* context, which cannot
    // spend a token. The token is spent in `onUpload` below, once the object actually
    // lands: check refuses the mint, consume records the cost, and a signed URL that
    // was minted but never used costs us nothing anyway.
    await rateLimiter.check(ctx, 'upload', { key: user._id, throws: true })
  },
  onUpload: async (ctx, _bucket, key) => {
    const user = await getCurrentUser(ctx)
    if (!user) return
    await rateLimiter.limit(ctx, 'upload', { key: user._id })
    await ctx.db.insert('uploads', { key, userId: user._id, createdAt: Date.now() })
  }
})

/** A durable, cacheable URL for an uploaded object.
 *
 *  Prefers a **public** URL built from `R2_PUBLIC_URL` (the bucket's public r2.dev
 *  subdomain or a custom domain) — stable and CDN-cacheable, which is what an
 *  avatar shown across a live message list needs. Without that env set we fall
 *  back to a signed URL with the **maximum** 7-day lifetime, so dev still works;
 *  it just isn't permanent. Configure `R2_PUBLIC_URL` for production. */
export async function objectUrl(key: string): Promise<string> {
  const base = process.env.R2_PUBLIC_URL
  if (base) return `${base.replace(/\/$/, '')}/${key}`
  return r2.getUrl(key, { expiresIn: 60 * 60 * 24 * 7 })
}

/** Reclaim the R2 objects behind a set of attachments — the ONE place "content with files
 *  was deleted → free its storage" lives, so every delete path (a `messages.remove`, and the
 *  cascade `cleanup.purgeMessage` when a channel/thread is deleted) calls the same code and
 *  none can drift or forget. Best-effort per object: a stray object is wasted storage, not a
 *  failure the delete should roll back on. */
export async function reclaimAttachments(
  ctx: MutationCtx,
  attachments: { key: string }[] | undefined
): Promise<void> {
  for (const attachment of attachments ?? []) {
    try {
      await r2.deleteObject(ctx, attachment.key)
    } catch {
      // orphaned object, not a user-facing failure
    }
  }
}

/** Adopt an uploaded object — a message/avatar/logo/cover now references it, so drop
 *  its orphan-tracking row and the daily sweep will leave it alone. Call this from
 *  every mutation that takes an uploaded `key` from the client.
 *
 *  **The key must be an unattached upload of the caller's own.** An R2 key is not a
 *  secret — it's visible in the URL of every attachment you can see — so without this
 *  check any member could hand someone *else's* key to `messages.send`, attach their
 *  file to a message of their own, and then delete that message: `messages.remove`
 *  deletes its attachments' R2 objects, so the file would vanish from the original
 *  message too. Requiring ownership of the (still-orphan) upload row makes the key a
 *  capability rather than a guessable name. */
export async function markUploadUsed(
  ctx: MutationCtx,
  userId: Id<'users'>,
  key: string
): Promise<void> {
  const row = await ctx.db
    .query('uploads')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique()
  if (!row || row.userId !== userId) {
    throw new ConvexError('That file upload is no longer available — try uploading it again')
  }
  await ctx.db.delete(row._id)
}

/** Adopt a freshly-uploaded object and return a durable URL for it — for the page editor's
 *  image / file / audio / video BLOCKS (BlockNote stores the returned URL in the block).
 *
 *  `markUploadUsed` drops the orphan-tracking row (so the daily sweep leaves the file alone),
 *  and we record the key in **`pageUploads`** keyed by the page's channel — because the block
 *  itself only stores the URL, that back-reference is the only way `cleanup.channel` can free
 *  the R2 object when the page is deleted. (A block *removed* mid-life still lingers until the
 *  page is deleted — the same lifetime as a message's attachments.) Access- + ownership-gated. */
export const resolveUpload = mutation({
  args: { key: v.string(), channelId: v.id('channels') },
  handler: async (ctx, { key, channelId }): Promise<string> => {
    const user = await requireUser(ctx)
    // Access-gated (private page channels included), and a page channel only — this only
    // adopts files for page media blocks.
    const access = await requireChannelAccess(ctx, channelId, user._id)
    if (access.channel.kind !== 'page') throw new ConvexError('That channel is not a page')
    await markUploadUsed(ctx, user._id, key)
    const url = await objectUrl(key)
    // The block stores only this URL (not the key), so record the key against the page so
    // `cleanup.channel` can reclaim the R2 object when the page is deleted.
    await ctx.db.insert('pageUploads', { channelId, key, createdBy: user._id, createdAt: Date.now() })
    return url
  }
})

/** Delete an uploaded object the caller **owns and hasn't attached yet** — the
 *  composer's "remove" before sending. No-op if there's no orphan row for the
 *  key (already referenced by a message, or not the caller's), so it can never
 *  delete a file that's live on a message. */
export const deleteUpload = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const user = await requireUser(ctx)
    const row = await ctx.db
      .query('uploads')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique()
    if (!row || row.userId !== user._id) return
    await ctx.db.delete(row._id)
    try {
      await r2.deleteObject(ctx, key)
    } catch {
      // orphaned object, not a user-facing failure
    }
  }
})

/** How stale an orphan upload must be before the sweep deletes it. Long enough
 *  that a slow upload-then-send never races the cron. */
const ORPHAN_TTL = 24 * 60 * 60 * 1000
/** Bounded per run — a delete-heavy mutation shouldn't be unbounded. Daily cadence
 *  clears any backlog over a few days. */
const SWEEP_BATCH = 100

/** Daily cron (`crons.ts`): delete R2 objects that were uploaded but never
 *  referenced — the tab was closed, the composer draft abandoned. Only orphans
 *  older than `ORPHAN_TTL` are touched; a used key has no `uploads` row. */
export const sweepOrphanUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ORPHAN_TTL
    const stale = await ctx.db
      .query('uploads')
      .withIndex('by_created', (q) => q.lt('createdAt', cutoff))
      .take(SWEEP_BATCH)
    for (const row of stale) {
      try {
        await r2.deleteObject(ctx, row.key)
      } catch {
        // ignore — still drop the row so we don't retry forever
      }
      await ctx.db.delete(row._id)
    }
  }
})

/** A media block REMOVED from a page (but the page kept) leaves its object live until the page
 *  is deleted — its `pageUploads` row still points at it. This weekly reconciliation reclaims
 *  those: for each `pageUploads` key past the grace window that the page's CURRENT content no
 *  longer references, delete the object + row.
 *
 *  Only reclaim what we can PROVE is stale — deleting a live file is data loss:
 *   - **Public URLs only.** With `R2_PUBLIC_URL` set, a live block stores `${base}/${key}`, so
 *     we can map URLs → keys. Without it (signed URLs), we can't — so the whole cron no-ops.
 *   - **Ambiguity guard.** If a page has ANY media block whose URL we can't map (a *signed* R2
 *     URL from before `R2_PUBLIC_URL` was set, or a corrupt/unparseable doc), we skip that whole
 *     page rather than risk deleting a key we simply couldn't see referenced.
 *   - **7-day grace**, so a just-uploaded object (not yet saved into the doc) is never swept. */
const PAGE_MEDIA_GRACE_MS = 7 * 24 * 60 * 60 * 1000
const RECONCILE_BATCH = 100
const MEDIA_BLOCK_TYPES = new Set(['image', 'video', 'audio', 'file'])

/** The R2 keys a page's BlockNote doc references (media-block URLs of the form `${prefix}${key}`),
 *  plus `ambiguous` = it holds a media URL we CAN'T map (signed / external / unparseable) so the
 *  page's uploads must not be reclaimed. Recurses into nested blocks (e.g. a toggle's children). */
function analyzePageMedia(content: string, prefix: string): { keys: Set<string>; ambiguous: boolean } {
  const keys = new Set<string>()
  let blocks: unknown
  try {
    blocks = JSON.parse(content)
  } catch {
    return { keys, ambiguous: true } // can't read it → don't reclaim anything for this page
  }
  let ambiguous = false
  const walk = (arr: unknown): void => {
    if (!Array.isArray(arr)) return
    for (const item of arr) {
      const block = item as { type?: string; props?: { url?: unknown }; children?: unknown }
      if (block.type && MEDIA_BLOCK_TYPES.has(block.type)) {
        const url = block.props?.url
        if (typeof url === 'string' && url) {
          if (url.startsWith(prefix)) keys.add(url.slice(prefix.length))
          else if (!url.startsWith('data:')) ambiguous = true // signed R2 or external — unmappable
        }
      }
      if (block.children) walk(block.children)
    }
  }
  walk(blocks)
  return { keys, ambiguous }
}

export const reconcilePageMedia = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const base = process.env.R2_PUBLIC_URL
    if (!base) return // signed URLs aren't mappable to keys — can't safely reconcile
    const prefix = `${base.replace(/\/$/, '')}/`
    const graceCutoff = Date.now() - PAGE_MEDIA_GRACE_MS

    const { page: rows, continueCursor, isDone } = await ctx.db
      .query('pageUploads')
      .paginate({ cursor: cursor ?? null, numItems: RECONCILE_BATCH })

    // Parse each page's content at most once per batch.
    const analyzed = new Map<string, { keys: Set<string>; ambiguous: boolean }>()
    for (const row of rows) {
      if (row.createdAt > graceCutoff) continue // inside the grace window — leave it
      const channelKey = row.channelId as string
      let info = analyzed.get(channelKey)
      if (!info) {
        const page = await ctx.db
          .query('pages')
          .withIndex('by_channel', (q) => q.eq('channelId', row.channelId))
          .unique()
        // No page row (already deleted) → nothing references it → safe to reclaim.
        info = page ? analyzePageMedia(page.content, prefix) : { keys: new Set(), ambiguous: false }
        analyzed.set(channelKey, info)
      }
      if (info.ambiguous || info.keys.has(row.key)) continue // can't confirm stale, or still live
      try {
        await r2.deleteObject(ctx, row.key)
      } catch {
        // ignore — still drop the row so we don't retry forever
      }
      await ctx.db.delete(row._id)
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.files.reconcilePageMedia, { cursor: continueCursor })
    }
  }
})
