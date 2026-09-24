import { useRef, useState } from 'react'

import { Button } from '@renderer/components/ui/button'
import { coverStyle, isImageCover, DEFAULT_COVER_Y } from '@renderer/components/doc/cover-data'
import { cn } from '@renderer/lib/utils'

/** Drag distance (px) that sweeps the full 0-100 focal range. */
const DRAG_RANGE_PX = 200

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** The doc's cover banner: a gradient, a colour, or an image you can drag to reposition. */
export function DocCover({
  cover,
  coverY,
  canEdit,
  onCoverYChange,
  onChange,
  onRemove
}: {
  cover: string
  coverY: number
  canEdit: boolean
  onCoverYChange: (y: number) => void
  onChange: () => void
  onRemove: () => void
}): React.JSX.Element {
  const [repositioning, setRepositioning] = useState(false)
  const dragRef = useRef<{ startY: number; startCoverY: number } | null>(null)
  // Only an image has a focal point — a gradient has nothing to reposition.
  const repositionable = isImageCover(cover)

  const onPointerDown = (event: React.PointerEvent): void => {
    if (!repositioning || !repositionable) return
    dragRef.current = { startY: event.clientY, startCoverY: coverY }

    const move = (moveEvent: PointerEvent): void => {
      if (!dragRef.current) return
      const dy = moveEvent.clientY - dragRef.current.startY
      // Dragging DOWN reveals the top of the image, so the focal point moves up.
      onCoverYChange(clamp(dragRef.current.startCoverY - (dy / DRAG_RANGE_PX) * 100, 0, 100))
    }
    const up = (): void => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // Listeners on `window` so the drag survives leaving the cover box.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      onPointerDown={onPointerDown}
      style={coverStyle(cover, coverY)}
      className={cn(
        'group/cover relative h-52 w-full shrink-0 select-none',
        repositioning && repositionable && 'cursor-grab active:cursor-grabbing'
      )}
    >
      {repositioning ? (
        // `text-white` over a photo is relative to the image, not the theme — the one
        // place a literal colour is right.
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 text-sm font-medium text-white">
          Drag image to reposition
        </div>
      ) : null}

      {canEdit ? (
        // Top-right: the page header overlaps the cover's BOTTOM edge.
        <div className="absolute top-3 right-3 flex gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover/cover:opacity-100">
          {repositioning ? (
            <CoverButton onClick={() => setRepositioning(false)}>Save position</CoverButton>
          ) : (
            <>
              <CoverButton onClick={onChange}>Change cover</CoverButton>
              {repositionable ? (
                <CoverButton onClick={() => setRepositioning(true)}>Reposition</CoverButton>
              ) : null}
              <CoverButton onClick={onRemove}>Remove</CoverButton>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function CoverButton({
  onClick,
  children
}: {
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={onClick}
      className="h-auto bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/70"
    >
      {children}
    </Button>
  )
}

export { DEFAULT_COVER_Y }
