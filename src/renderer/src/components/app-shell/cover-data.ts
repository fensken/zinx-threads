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

/** Compose the CSS background for a cover value (gradient key or image URL). */
export function coverStyle(cover: string, y = 50): React.CSSProperties {
  if (cover.startsWith('gradient:')) {
    return {
      backgroundImage: COVER_GRADIENTS[cover.slice('gradient:'.length)] ?? COVER_GRADIENTS.aurora
    }
  }
  return {
    backgroundImage: `url("${cover}")`,
    backgroundSize: 'cover',
    backgroundPosition: `center ${y}%`,
    backgroundRepeat: 'no-repeat'
  }
}

// A curated set of Unsplash photos. zinx-threads has no backend to hold an
// Unsplash key, so this mirrors _zinx's picker UX over a fixed gallery.
export interface UnsplashCover {
  id: string
  tags: string
  color: string
  author: string
}

export const UNSPLASH_COVERS: UnsplashCover[] = [
  {
    id: '1506744038136-46273834b3fb',
    tags: 'mountain valley landscape nature',
    color: '#4b5a63',
    author: 'Bailey Zindel'
  },
  {
    id: '1470071459604-3b5ec3a7fe05',
    tags: 'foggy mountain forest nature',
    color: '#5b6b70',
    author: 'Kevin'
  },
  {
    id: '1441974231531-c6227db76b6e',
    tags: 'forest trees green nature',
    color: '#3f5a3a',
    author: 'Sergei A'
  },
  {
    id: '1501785888041-af3ef285b470',
    tags: 'lake mountain sunrise nature',
    color: '#6a7f8c',
    author: 'Luca Bravo'
  },
  {
    id: '1519681393784-d120267933ba',
    tags: 'mountain night stars sky',
    color: '#1e293b',
    author: 'Benjamin Voros'
  },
  {
    id: '1447752875215-b2761acb3c5d',
    tags: 'forest path trees green',
    color: '#3c4a33',
    author: 'Casey Horner'
  },
  {
    id: '1493246507139-91e8fad9978e',
    tags: 'purple abstract sky gradient',
    color: '#5b4b8a',
    author: 'Marek Piwnicki'
  },
  {
    id: '1426604966848-d7adac402bff',
    tags: 'valley green landscape nature',
    color: '#556b4f',
    author: 'Bailey Zindel'
  },
  {
    id: '1470252649378-9c29740c9fa8',
    tags: 'mountain autumn orange nature',
    color: '#8a6a4b',
    author: 'Kalen Emsley'
  },
  {
    id: '1439066615861-d1af74d74000',
    tags: 'foggy forest dark trees',
    color: '#2f3a36',
    author: 'Ken Cheung'
  },
  {
    id: '1465101162946-4377e57745c3',
    tags: 'aurora night sky blue',
    color: '#1c2a3a',
    author: 'Vincentiu Solomon'
  },
  {
    id: '1518098268026-4e89f1a2cd8e',
    tags: 'ocean beach water blue',
    color: '#3d5a6c',
    author: 'Sean O.'
  }
]

export function unsplashUrl(id: string, w: number): string {
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`
}
