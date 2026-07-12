import { useEffect, useState } from 'react'
import { useAction } from 'convex/react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/utils'

type GifResult = { id: string; title: string; preview: string; full: string }
/** Which KLIPY media the tab searches — matches the action's `media` arg. */
type MediaKind = 'gifs' | 'stickers'
/** What a picked item is, for the caller's markdown alt (`![gif]` / `![sticker]`). */
export type PickedMediaKind = 'gif' | 'sticker'

const TABS: { key: MediaKind; label: string; single: PickedMediaKind }[] = [
  { key: 'gifs', label: 'GIFs', single: 'gif' },
  { key: 'stickers', label: 'Stickers', single: 'sticker' }
]

/** KLIPY media picker — Discord-style tabbed **GIFs / Stickers** in one container
 *  (both come from KLIPY; only the search endpoint differs). Searches via the
 *  `gifs.search` Convex action so the key stays server-side; each tab keeps its
 *  own query + results. Shows an empty state when no key is set.
 *
 *  `tabs` narrows which tabs appear (edit-in-place only swaps like-for-like); with
 *  one tab the tab bar is hidden. The old `onGifSelect(url)` still works —
 *  `onSelect(url, kind)` is the richer form the composer uses to tag the markdown. */
export function GifPicker({
  onSelect,
  onGifSelect,
  tabs = ['gifs', 'stickers'],
  className
}: {
  onSelect?: (url: string, kind: PickedMediaKind) => void
  onGifSelect?: (url: string) => void
  tabs?: MediaKind[]
  className?: string
}): React.JSX.Element {
  const visibleTabs = TABS.filter((tab) => tabs.includes(tab.key))
  const [active, setActive] = useState<MediaKind>(visibleTabs[0]?.key ?? 'gifs')
  const activeTab = visibleTabs.find((tab) => tab.key === active) ?? visibleTabs[0]

  const pick = (url: string): void => {
    onSelect?.(url, activeTab.single)
    onGifSelect?.(url)
  }

  return (
    <div
      className={cn(
        'flex h-[min(400px,60dvh)] w-[min(350px,calc(100dvw-2rem))] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl',
        className
      )}
    >
      {visibleTabs.length > 1 ? (
        <div className="flex shrink-0 gap-1 border-b p-1.5">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                active === tab.key
                  ? 'bg-accent font-semibold text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* One `MediaGrid` per tab, kept mounted so switching back is instant and
          each tab keeps its own search. Only the active one renders. */}
      {visibleTabs.map((tab) =>
        tab.key === active ? <MediaGrid key={tab.key} media={tab.key} onPick={pick} /> : null
      )}

      {/* KLIPY attribution: required wherever KLIPY content is shown. */}
      <a
        href="https://klipy.com"
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-7 shrink-0 items-center justify-center gap-1 border-t text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        Powered by <span className="font-semibold tracking-tight">KLIPY</span>
      </a>
    </div>
  )
}

/** The search box + result grid for one media kind. */
function MediaGrid({
  media,
  onPick
}: {
  media: MediaKind
  onPick: (url: string) => void
}): React.JSX.Element {
  const searchMedia = useAction(api.gifs.search)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GifResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const noun = media === 'stickers' ? 'stickers' : 'GIFs'

  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      if (!active) return
      setLoading(true)
      setError(false)
      searchMedia({ query, media })
        .then((items) => {
          if (!active) return
          setResults(items)
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
  }, [query, media, searchMedia])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <MagnifyingGlass className="size-4 shrink-0 opacity-50" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${noun}`}
          className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Failed to load {noun}
          </div>
        ) : results.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            No {noun} found
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPick(item.full)}
                className="relative h-auto overflow-hidden rounded transition hover:ring-2 hover:ring-primary focus:ring-2 focus:ring-primary focus:outline-none"
              >
                <img
                  src={item.preview}
                  alt={item.title}
                  loading="lazy"
                  className="h-auto w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
