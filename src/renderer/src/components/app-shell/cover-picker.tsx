import { useState } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import { COVER_GRADIENTS, UNSPLASH_COVERS, unsplashUrl } from './cover-data'

type Tab = 'gallery' | 'unsplash' | 'link'

/** Notion-style cover picker (centered modal): gradient gallery, Unsplash, link. */
export function CoverPicker({
  onSelect,
  onClose
}: {
  onSelect: (cover: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('gallery')
  const [query, setQuery] = useState('')
  const [link, setLink] = useState('')

  const filtered = query.trim()
    ? UNSPLASH_COVERS.filter((photo) => photo.tags.includes(query.trim().toLowerCase()))
    : UNSPLASH_COVERS

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-24"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-1 border-b px-2 pt-2">
          <TabButton active={tab === 'gallery'} onClick={() => setTab('gallery')}>
            Gallery
          </TabButton>
          <TabButton active={tab === 'unsplash'} onClick={() => setTab('unsplash')}>
            Unsplash
          </TabButton>
          <TabButton active={tab === 'link'} onClick={() => setTab('link')}>
            Link
          </TabButton>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="my-1 ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {tab === 'gallery' ? (
          <div className="no-scrollbar grid grid-cols-4 gap-2 overflow-y-auto p-3">
            {Object.keys(COVER_GRADIENTS).map((key) => (
              <button
                key={key}
                type="button"
                title={key}
                onClick={() => onSelect(`gradient:${key}`)}
                style={{ backgroundImage: COVER_GRADIENTS[key] }}
                className="h-16 rounded-lg ring-1 ring-border transition-transform hover:scale-[1.03] hover:ring-2 hover:ring-primary"
              />
            ))}
          </div>
        ) : null}

        {tab === 'unsplash' ? (
          <>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
              <MagnifyingGlass className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search free photos… (try: mountain, forest, ocean)"
                className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="no-scrollbar flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No photos found</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {filtered.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => onSelect(unsplashUrl(photo.id, 1600))}
                      className="group relative h-24 overflow-hidden rounded-md ring-1 ring-border hover:ring-2 hover:ring-primary"
                      style={{ backgroundColor: photo.color }}
                    >
                      <img
                        src={unsplashUrl(photo.id, 400)}
                        alt={photo.tags}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {photo.author}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="shrink-0 border-t px-3 py-1.5 text-center text-[11px] text-muted-foreground">
              Photos from{' '}
              <a
                href="https://unsplash.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Unsplash
              </a>
            </div>
          </>
        ) : null}

        {tab === 'link' ? (
          <form
            className="flex flex-col gap-2 p-3"
            onSubmit={(event) => {
              event.preventDefault()
              const url = link.trim()
              if (url) onSelect(url)
            }}
          >
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="Paste an image URL…"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!link.trim()}
              className="h-8 self-start rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Add cover
            </button>
            <p className="text-[11px] text-muted-foreground">
              Works with any direct image URL (https).
            </p>
          </form>
        ) : null}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}
