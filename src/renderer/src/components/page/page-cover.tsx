import { useRef, useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { coverStyle } from '@renderer/components/page/cover-data'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Full-width page cover with hover controls (Change / Reposition / Remove).
 *  Reposition drags the focal point vertically for image covers. */
export function PageCover({
  cover,
  coverY,
  onCoverYChange,
  onChange,
  onRemove
}: {
  cover: string
  coverY: number
  onCoverYChange: (y: number) => void
  onChange: () => void
  onRemove: () => void
}): React.JSX.Element {
  const [repositioning, setRepositioning] = useState(false)
  const dragRef = useRef<{ startY: number; startCoverY: number } | null>(null)
  const isImage = !cover.startsWith('gradient:')

  const onPointerDown = (event: React.PointerEvent): void => {
    if (!repositioning || !isImage) return
    dragRef.current = { startY: event.clientY, startCoverY: coverY }
    const move = (moveEvent: PointerEvent): void => {
      if (!dragRef.current) return
      const dy = moveEvent.clientY - dragRef.current.startY
      // Drag down → reveal the top of the image (focal point moves up).
      onCoverYChange(clamp(dragRef.current.startCoverY - (dy / 200) * 100, 0, 100))
    }
    const up = (): void => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      onPointerDown={onPointerDown}
      style={coverStyle(cover, coverY)}
      className={cn(
        'group/cover relative h-52 w-full shrink-0 select-none',
        repositioning && isImage && 'cursor-grab active:cursor-grabbing'
      )}
    >
      {repositioning ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 text-sm font-medium text-white">
          Drag image to reposition
        </div>
      ) : null}

      {/* Controls sit at the TOP of the cover (like Notion): the page header
          overlaps the cover's BOTTOM edge, so bottom controls get covered. */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover/cover:opacity-100">
        {repositioning ? (
          <CoverButton onClick={() => setRepositioning(false)}>Save position</CoverButton>
        ) : (
          <>
            <CoverButton onClick={onChange}>Change cover</CoverButton>
            {isImage ? (
              <CoverButton onClick={() => setRepositioning(true)}>Reposition</CoverButton>
            ) : null}
            <CoverButton onClick={onRemove}>Remove</CoverButton>
          </>
        )}
      </div>
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
    <button
      type="button"
      onClick={onClick}
      className="rounded-md bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/70"
    >
      {children}
    </button>
  )
}
