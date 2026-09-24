import type { CSSProperties } from 'react'

/**
 * Cover presets and encoding for a doc channel's page cover.
 *
 * A cover is ONE string:
 *   `gradient:<key>` → a preset from `COVER_GRADIENTS`
 *   `color:<#hex>`   → a solid colour
 *   anything else    → a direct image URL (Unsplash, a pasted link, or an R2 upload
 *                      already resolved to its public URL)
 *
 * One column rather than a value plus a discriminator: the form is recoverable from the
 * prefix, and the value stays trivially portable (it round-trips through the local-mode
 * export unchanged). `coverY` (0-100) is the vertical focal point and applies only to the
 * image case — a gradient has nothing to reposition.
 *
 * **Mirrored server-side** by `convex/docs.ts` `validateCover`, which is the real boundary:
 * this value lands in a CSS `url()` on every reader's screen, so the encoding here is a
 * convenience and the validation there is the guard.
 */

export const COVER_GRADIENTS: Record<string, string> = {
  aurora: 'linear-gradient(135deg, #5eead4 0%, #6366f1 50%, #a855f7 100%)',
  ocean: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
  sunset: 'linear-gradient(135deg, #f97316 0%, #ef4444 50%, #ec4899 100%)',
  forest: 'linear-gradient(135deg, #22c55e 0%, #065f46 100%)',
  dusk: 'linear-gradient(135deg, #6366f1 0%, #1e293b 100%)',
  ember: 'linear-gradient(135deg, #f59e0b 0%, #b91c1c 100%)',
  rose: 'linear-gradient(135deg, #fb7185 0%, #e11d48 100%)',
  violet: 'linear-gradient(135deg, #a78bfa 0%, #6d28d9 100%)',
  mint: 'linear-gradient(135deg, #6ee7b7 0%, #059669 100%)',
  slate: 'linear-gradient(135deg, #94a3b8 0%, #334155 100%)'
}

export const DEFAULT_COVER_Y = 50

/** True when the cover is a real image — i.e. the only case that can be repositioned. */
export function isImageCover(cover: string): boolean {
  return !cover.startsWith('gradient:') && !cover.startsWith('color:')
}

/** Inline style for a cover value at a given focal point. */
export function coverStyle(cover: string, y = DEFAULT_COVER_Y): CSSProperties {
  if (cover.startsWith('gradient:')) {
    const key = cover.slice('gradient:'.length)
    return { backgroundImage: COVER_GRADIENTS[key] ?? COVER_GRADIENTS.aurora }
  }
  if (cover.startsWith('color:')) {
    return { backgroundColor: cover.slice('color:'.length) }
  }
  return {
    backgroundImage: `url("${cover}")`,
    backgroundSize: 'cover',
    backgroundPosition: `center ${y}%`,
    backgroundRepeat: 'no-repeat'
  }
}
