import { useRef } from 'react'
import { cn } from '@renderer/lib/utils'

/** A thin draggable divider. Reports horizontal drag deltas to the parent. */
export function ResizeHandle({
  onDelta,
  className
}: {
  onDelta: (dx: number) => void
  className?: string
}): React.JSX.Element {
  const dragging = useRef(false)
  const lastX = useRef(0)

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(event) => {
        dragging.current = true
        lastX.current = event.clientX
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return
        const dx = event.clientX - lastX.current
        lastX.current = event.clientX
        if (dx !== 0) onDelta(dx)
      }}
      onPointerUp={(event) => {
        dragging.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      className={cn(
        'relative z-10 -mx-0.5 w-1.5 shrink-0 cursor-col-resize touch-none',
        'before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors',
        'hover:before:bg-primary/50 active:before:bg-primary',
        className
      )}
    />
  )
}
