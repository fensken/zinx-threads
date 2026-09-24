import { useCallback, useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { ArrowClockwise, MagnifyingGlass } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { useDebouncedValue } from '@renderer/lib/use-debounced-callback'
import { cn } from '@renderer/lib/utils'

type UnsplashPhoto = {
  id: string
  urls: { raw: string; full: string; regular: string; small: string; thumb: string }
  alt: string
  color: string
  downloadLocation: string
  user: { name: string; username: string }
}

type Status = 'ok' | 'rate-limited' | 'unavailable'

/**
 * How long the query must sit still before we spend a request.
 *
 * Deliberately longer than a typical search-as-you-type debounce. Unsplash's free tier is
 * measured in **tens of requests per hour**, and at 250ms every pause mid-word bought its own
 * API call — typing "everest" could cost seven. Burning the quota on prefixes nobody wanted
 * results for is what made a later, real search come back empty.
 */
const SEARCH_DEBOUNCE_MS = 450

/** Bounded so a long picking session can't grow it without limit. */
const MAX_CACHED_QUERIES = 40

/** Unsplash image search — searches via the `unsplash.search` Convex action, so the key
 *  stays server-side, and fires the required download-tracking ping on select. */
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
  const [status, setStatus] = useState<Status>('ok')
  /** Bumped by "Try again" to re-run the effect for an unchanged query. */
  const [attempt, setAttempt] = useState(0)
  // `loading` is DERIVED from whether the results reflect the settled query — no synchronous
  // setState in the effect, and the spinner can't drift out of sync with the grid.
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null)

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const loading = loadedQuery !== debouncedQuery

  // Backspacing through a word re-asks for prefixes we just searched. With a quota this
  // small, serving those from memory is the difference between the picker working and the
  // picker reporting "no photos" for everything.
  const cache = useRef(new Map<string, UnsplashPhoto[]>())

  useEffect(() => {
    const key = debouncedQuery.trim()
    const cached = cache.current.get(key)
    if (cached) {
      setPhotos(cached)
      setStatus('ok')
      setLoadedQuery(debouncedQuery)
      return
    }

    // `active` guards a stale response from a prior query overwriting a newer one.
    let active = true
    searchPhotos({ query: debouncedQuery })
      .then((result) => {
        if (!active) return
        if (result.status === 'ok') {
          setPhotos(result.photos)
          cache.current.set(key, result.photos)
          if (cache.current.size > MAX_CACHED_QUERIES) {
            // Map preserves insertion order, so the first key is the oldest.
            cache.current.delete(cache.current.keys().next().value as string)
          }
        }
        // On a failure the previous photos stay on screen — blanking the grid to show an
        // error throws away results the user can still use.
        setStatus(result.status)
        setLoadedQuery(debouncedQuery)
      })
      .catch(() => {
        if (!active) return
        setStatus('unavailable')
        setLoadedQuery(debouncedQuery)
      })
    return () => {
      active = false
    }
  }, [debouncedQuery, searchPhotos, attempt])

  const retry = useCallback(() => {
    cache.current.delete(debouncedQuery.trim())
    setLoadedQuery(null)
    setAttempt((n) => n + 1)
  }, [debouncedQuery])

  const pick = (photo: UnsplashPhoto): void => {
    void trackDownload({ downloadLocation: photo.downloadLocation })
    onSelect(photo.urls.regular)
  }

  const hasPhotos = photos.length > 0
  // Only ever claim "nothing matched" when a search actually SETTLED and succeeded — never
  // while one is in flight, and never for a rate limit or an outage.
  const showEmpty = !loading && status === 'ok' && !hasPhotos

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
        {/* The spinner lives here, not over the grid, so a new search doesn't blank the
            results you're still looking at. */}
        {loading ? <Spinner className="size-4 shrink-0 text-muted-foreground" /> : null}
      </div>

      {status !== 'ok' ? (
        <div className="flex items-center gap-2 border-b bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">
            {status === 'rate-limited'
              ? 'Too many searches just now — give it a few seconds.'
              : 'Photo search is unavailable right now.'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={retry}
            className="h-6 shrink-0 gap-1 px-1.5 text-xs"
          >
            <ArrowClockwise className="size-3.5" />
            Try again
          </Button>
        </div>
      ) : null}

      <div className="no-scrollbar flex-1 overflow-y-auto p-2">
        {hasPhotos ? (
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
        ) : loading ? (
          <div className="flex h-full min-h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : showEmpty ? (
          <div className="flex h-full min-h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {loadedQuery?.trim() ? `No photos match “${loadedQuery.trim()}”` : 'No photos to show'}
          </div>
        ) : null}
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
