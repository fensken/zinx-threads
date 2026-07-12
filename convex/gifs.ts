import { v } from 'convex/values'
import { action } from './_generated/server'
import { requireIdentity } from './lib/auth'
import { rateLimiter } from './rateLimiter'

// KLIPY media search proxy — GIFs *and* stickers (KLIPY exposes both under the
// same API shape, only the path segment differs: `/gifs` vs `/stickers`). Keeps
// the KLIPY key server-side and normalizes the response into a small
// `{ id, title, preview, full }` shape for the picker. Returns [] when the key
// isn't configured, so the UI degrades quietly.
//
// Env: `npx convex env set KLIPY_API_KEY <key>`

/** One rendered file, keyed by format (`gif` / `webp` / `png` / `mp4` / …). We
 *  only ever pick a raster still/animation the browser can put in an `<img>`. */
type KlipySize = Record<string, { url?: string } | undefined>

interface KlipyItem {
  id: string | number
  title?: string
  slug?: string
  file?: {
    hd?: KlipySize
    md?: KlipySize
    sm?: KlipySize
    xs?: KlipySize
  }
}

export type GifResult = { id: string; title: string; preview: string; full: string }

/** GIFs are `gif`; stickers are transparent, so prefer `webp` (animation +
 *  alpha, native in Chromium/Electron) then `png`, then `gif`. Video formats
 *  (`mp4`/`webm`) are skipped — they can't go in an `<img>`. */
const FORMAT_PREFERENCE: Record<'gifs' | 'stickers', string[]> = {
  gifs: ['gif', 'webp'],
  stickers: ['webp', 'png', 'gif']
}

const VIDEO_FORMATS = new Set(['mp4', 'webm'])

/** First usable URL in a size bucket: the preferred formats in order, then any
 *  non-video format present. */
function pickUrl(size: KlipySize | undefined, prefer: string[]): string | undefined {
  if (!size) return undefined
  for (const format of prefer) {
    const url = size[format]?.url
    if (url) return url
  }
  for (const [format, variant] of Object.entries(size)) {
    if (!VIDEO_FORMATS.has(format) && variant?.url) return variant.url
  }
  return undefined
}

export const search = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    media: v.optional(v.union(v.literal('gifs'), v.literal('stickers')))
  },
  handler: async (ctx, { query, limit, media }): Promise<GifResult[]> => {
    // Signed-in callers only — this spends our KLIPY quota. Per-user rate limited;
    // degrade to no results rather than erroring the picker.
    const identity = await requireIdentity(ctx)
    if (!(await rateLimiter.limit(ctx, 'gifSearch', { key: identity.subject })).ok) return []
    const apiKey = process.env.KLIPY_API_KEY
    if (!apiKey) return []

    const kind = media ?? 'gifs'
    const prefer = FORMAT_PREFERENCE[kind]
    const perPage = String(Math.min(50, Math.max(1, limit ?? 30)))
    const base = `https://api.klipy.com/api/v1/${apiKey}/${kind}`
    const q = query.trim()
    const endpoint = q
      ? `${base}/search?${new URLSearchParams({ q, per_page: perPage, customer_id: 'zinx-threads' })}`
      : `${base}/trending?${new URLSearchParams({ per_page: perPage, customer_id: 'zinx-threads' })}`

    try {
      const res = await fetch(endpoint)
      if (!res.ok) return []
      const json = (await res.json()) as { data?: { data?: KlipyItem[] } }
      const items = json.data?.data ?? []
      const results: GifResult[] = []
      for (const item of items) {
        const full = pickUrl(item.file?.hd, prefer) ?? pickUrl(item.file?.md, prefer)
        const preview = pickUrl(item.file?.sm, prefer) ?? pickUrl(item.file?.xs, prefer) ?? full
        if (full && preview) {
          results.push({
            id: String(item.id),
            title: item.title ?? item.slug ?? (kind === 'stickers' ? 'Sticker' : 'GIF'),
            preview,
            full
          })
        }
      }
      return results
    } catch {
      return []
    }
  }
})
