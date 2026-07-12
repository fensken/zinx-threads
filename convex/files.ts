import { ConvexError, v } from 'convex/values'
import { R2 } from '@convex-dev/r2'
import { mutation, internalMutation, type MutationCtx } from './_generated/server'
import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { getCurrentUser, requireUser } from './lib/auth'

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
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new ConvexError('You must be signed in to upload')
  },
  onUpload: async (ctx, _bucket, key) => {
    const user = await getCurrentUser(ctx)
    if (!user) return
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

/** Mark an uploaded object as **used** — a message/avatar/logo now references it,
 *  so drop its orphan-tracking row and the daily sweep will leave it alone.
 *  Call this from every mutation that adopts an uploaded `key`. */
export async function markUploadUsed(ctx: MutationCtx, key: string): Promise<void> {
  const row = await ctx.db
    .query('uploads')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique()
  if (row) await ctx.db.delete(row._id)
}

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
