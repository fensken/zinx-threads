import { v } from 'convex/values'
import { action } from './_generated/server'
import { requireIdentity } from './lib/auth'
import { rateLimiter } from './rateLimiter'

// Unsplash search proxy. Keeps UNSPLASH_ACCESS_KEY server-side and normalizes
// the response for the picker. Also proxies the required download-tracking ping
// (Unsplash API guideline) — pinned to the Unsplash origin so the key can't be
// leaked to an arbitrary host (SSRF guard). Returns [] when no key is set.
//
// Env: `npx convex env set UNSPLASH_ACCESS_KEY <key>`

interface UnsplashApiPhoto {
  id: string
  alt_description?: string | null
  description?: string | null
  width: number
  height: number
  color?: string | null
  urls: { raw: string; full: string; regular: string; small: string; thumb: string }
  links: { download_location: string }
  user: { name: string; username: string }
}

export type UnsplashPhoto = {
  id: string
  urls: UnsplashApiPhoto['urls']
  alt: string
  color: string
  downloadLocation: string
  user: { name: string; username: string }
}

function normalize(p: UnsplashApiPhoto): UnsplashPhoto {
  return {
    id: p.id,
    urls: p.urls,
    alt: p.alt_description ?? p.description ?? 'Unsplash photo',
    color: p.color ?? '#cccccc',
    downloadLocation: p.links.download_location,
    user: { name: p.user.name, username: p.user.username }
  }
}

export const search = action({
  args: { query: v.string(), perPage: v.optional(v.number()) },
  handler: async (ctx, { query, perPage }): Promise<UnsplashPhoto[]> => {
    // Signed-in callers only — this spends our Unsplash quota. Per-user rate limited
    // (Unsplash free tier is strict); degrade to no results rather than erroring.
    const identity = await requireIdentity(ctx)
    if (!(await rateLimiter.limit(ctx, 'unsplash', { key: identity.subject })).ok) return []
    const apiKey = process.env.UNSPLASH_ACCESS_KEY
    if (!apiKey) return []
    const auth = { headers: { Authorization: `Client-ID ${apiKey}` } }
    const per = String(Math.min(30, Math.max(1, perPage ?? 30)))
    const q = query.trim()
    const endpoint = q
      ? `https://api.unsplash.com/search/photos?${new URLSearchParams({ query: q, per_page: per })}`
      : `https://api.unsplash.com/photos?${new URLSearchParams({ per_page: per })}`

    try {
      const res = await fetch(endpoint, auth)
      if (!res.ok) return []
      const json = (await res.json()) as UnsplashApiPhoto[] | { results?: UnsplashApiPhoto[] }
      const items = Array.isArray(json) ? json : (json.results ?? [])
      return items.map(normalize)
    } catch {
      return []
    }
  }
})

/** Best-effort download tracking (required when a photo is actually used).
 *  `downloadLocation` is client-supplied → pinned to the Unsplash API origin. */
export const trackDownload = action({
  args: { downloadLocation: v.string() },
  handler: async (ctx, { downloadLocation }): Promise<void> => {
    const identity = await requireIdentity(ctx)
    if (!(await rateLimiter.limit(ctx, 'unsplash', { key: identity.subject })).ok) return
    const apiKey = process.env.UNSPLASH_ACCESS_KEY
    if (!apiKey) return
    let target: URL
    try {
      target = new URL(downloadLocation)
    } catch {
      return
    }
    if (target.origin !== 'https://api.unsplash.com') return
    try {
      await fetch(target, { headers: { Authorization: `Client-ID ${apiKey}` } })
    } catch {
      // never block the UI on tracking
    }
  }
})
