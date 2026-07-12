import { useEffect, useState } from 'react'
import { useAction } from 'convex/react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/utils'

type UnsplashPhoto = {
  id: string
  urls: { raw: string; full: string; regular: string; small: string; thumb: string }
  alt: string
  color: string
  downloadLocation: string
  user: { name: string; username: string }
}

/** Unsplash image search — same design as zinx-os's `unsplash-image-picker`, but
 *  searches via the `unsplash.search` Convex action (key stays server-side) and
 *  fires the required download-tracking ping on select. Empty without a key. */
export function UnsplashPicker({
  onSelect,
  columns = 2,
  className
}: {
  onSelect: (url: string) => void
  columns?: number
  className?: string
}): React.JSX.Element {
  const searchPhotos = useAction(api.unsplash.search)
  const trackDownload = useAction(api.unsplash.trackDownload)
  const [query, setQuery] = useState('')
  const [photos, setPhotos] = useState<UnsplashPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      if (!active) return
      setLoading(true)
      setError(false)
      searchPhotos({ query })
        .then((results) => {
          if (!active) return
          setPhotos(results)
          setLoading(false)
        })
        .catch(() => {
          if (!active) return
          setError(true)
          setLoading(false)
        })
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query, searchPhotos])

  const pick = (photo: UnsplashPhoto): void => {
    void trackDownload({ downloadLocation: photo.downloadLocation })
    onSelect(photo.urls.regular)
  }

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden bg-popover text-popover-foreground',
        className
      )}
    >
      <div className="flex h-9 items-center gap-2 border-b px-3">
        <MagnifyingGlass className="size-4 shrink-0 opacity-50" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Unsplash"
          className="h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex h-full min-h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
            Failed to load photos
          </div>
        ) : photos.length === 0 ? (
          <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
            No photos found
          </div>
        ) : (
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => pick(photo)}
                title={`Photo by ${photo.user.name}`}
                style={{ backgroundColor: photo.color }}
                className="relative aspect-video overflow-hidden rounded transition hover:ring-2 hover:ring-primary focus:ring-2 focus:ring-primary focus:outline-none"
              >
                <img
                  src={photo.urls.small}
                  alt={photo.alt}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        Photos from{' '}
        <a
          href="https://unsplash.com"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
        >
          Unsplash
        </a>
      </div>
    </div>
  )
}
