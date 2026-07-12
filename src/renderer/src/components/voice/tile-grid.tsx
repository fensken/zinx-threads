import { useEffect, useRef, useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'

/** One tile to place in the grid. `node` is whatever renders inside the 16:9 cell
 *  (a real LiveKit `VoiceTile`, or a mock tile in the demo). */
export interface TileItem {
  key: string
  node: React.ReactNode
}

const GRID_GAP = 12
/** Tiles per page. Beyond this, the grid paginates (Discord shows a page + arrows
 *  rather than shrinking 50 people into unreadable thumbnails). 4×4 keeps faces
 *  legible while showing plenty at once. */
const MAX_PER_PAGE = 16

/**
 * Discord-style call grid — LiveKit-free so both the real call and the demo use it.
 * Every tile is 16:9, sized to the LARGEST that fits the page in the container,
 * centered wrapping rows (short last row centers). Past `MAX_PER_PAGE` it paginates
 * with prev/next arrows + page dots, so 50 people stay legible instead of tiny.
 */
export function TileGrid({ tiles }: { tiles: TileItem[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const { width, height } = useElementSize(containerRef)
  const [page, setPage] = useState(0)

  const pageCount = Math.max(1, Math.ceil(tiles.length / MAX_PER_PAGE))
  const current = Math.min(page, pageCount - 1)
  const start = current * MAX_PER_PAGE
  const pageTiles = tiles.slice(start, start + MAX_PER_PAGE)
  const tileWidth = bestTileWidth(width, height, pageTiles.length, GRID_GAP)

  return (
    <div className="relative flex h-full w-full flex-col">
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-wrap content-center items-center justify-center"
        style={{ gap: GRID_GAP }}
      >
        {pageTiles.map((tile) => (
          <div
            key={tile.key}
            className="aspect-video"
            style={tileWidth > 0 ? { width: tileWidth } : { width: '40%' }}
          >
            {tile.node}
          </div>
        ))}
      </div>

      {pageCount > 1 ? (
        <>
          {current > 0 ? <PageArrow side="left" onClick={() => setPage(current - 1)} /> : null}
          {current < pageCount - 1 ? (
            <PageArrow side="right" onClick={() => setPage(current + 1)} />
          ) : null}
          <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center gap-1.5">
            {Array.from({ length: pageCount }).map((_, index) => (
              <span
                key={index}
                className={cn(
                  'size-1.5 rounded-full transition-colors',
                  index === current ? 'bg-primary' : 'bg-muted-foreground/40'
                )}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function PageArrow({
  side,
  onClick
}: {
  side: 'left' | 'right'
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous page' : 'Next page'}
      className={cn(
        'absolute top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70',
        side === 'left' ? 'left-2' : 'right-2'
      )}
    >
      {side === 'left' ? (
        <CaretLeft className="size-5" weight="bold" />
      ) : (
        <CaretRight className="size-5" weight="bold" />
      )}
    </button>
  )
}

/** The widest 16:9 tile such that `count` of them (in some rows × cols split) fit a
 *  `width`×`height` box with `gap` spacing — try every column count, keep the best. */
function bestTileWidth(width: number, height: number, count: number, gap: number): number {
  if (width <= 0 || height <= 0 || count === 0) return 0
  let best = 0
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const maxTileWidth = (width - gap * (cols - 1)) / cols
    const maxTileHeight = (height - gap * (rows - 1)) / rows
    const fit = Math.min(maxTileWidth, maxTileHeight * (16 / 9))
    if (fit > best) best = fit
  }
  return Math.floor(best)
}

/** Live size of an element (ResizeObserver) — drives the grid's best-fit math. */
function useElementSize(ref: React.RefObject<HTMLDivElement | null>): {
  width: number
  height: number
} {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}
