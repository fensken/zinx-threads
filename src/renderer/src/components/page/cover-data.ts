// Cover data + helpers (kept out of the picker component file so it can stay a
// components-only module for react-refresh).

// Decorative cover gradients (content, like avatar colors — not UI-chrome tokens).
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

/** Compose the CSS background for a cover value: `gradient:<key>`, `color:<hex>`,
 *  or an image URL (Unsplash / pasted link). */
export function coverStyle(cover: string, y = 50): React.CSSProperties {
  if (cover.startsWith('gradient:')) {
    return {
      backgroundImage: COVER_GRADIENTS[cover.slice('gradient:'.length)] ?? COVER_GRADIENTS.aurora
    }
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
