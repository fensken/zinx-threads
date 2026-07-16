import { useCallback, useState } from 'react'

/** Grab the empty background of a scrolling surface and drag it, the way
 *  Trello/Figma/Jira let you pan a board — so a wide board doesn't force you down
 *  to the scrollbar to reach the far columns.
 *
 *  `ignoreSelector` marks what is NOT background: a pointerdown inside a match is
 *  left alone, so dragging a column still reorders it (dnd-kit's sensors live on
 *  those elements) and clicking a button still clicks it. Everything else pans.
 *
 *  **Mouse only** (`pointerType === 'mouse'`). A touch drag already scrolls the
 *  container natively; hijacking it would fight the browser and lose momentum and
 *  rubber-banding.
 *
 *  The element is taken from the event's `currentTarget` — the handler is attached
 *  to the scroll container, so that *is* the container, with no ref to forward
 *  through whatever component renders it.
 *
 *  The move/up listeners go on the **window**, not the element: while panning, the
 *  pointer routinely ends up outside the board (it's the content that moves under
 *  it), and a release out there would otherwise never end the drag — leaving the
 *  board glued to the cursor. */
export function useDragPan(ignoreSelector: string): {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  /** True while panning — drive `cursor-grabbing` + suppress text selection. */
  panning: boolean
} {
  const [panning, setPanning] = useState(false)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      if (event.target instanceof Element && event.target.closest(ignoreSelector)) return

      const element = event.currentTarget
      const startX = event.clientX
      const startY = event.clientY
      const startLeft = element.scrollLeft
      const startTop = element.scrollTop
      let moved = false

      const onMove = (move: PointerEvent): void => {
        const dx = move.clientX - startX
        const dy = move.clientY - startY
        // Don't flip the cursor (or kill text selection) on a plain click — only
        // once it's unambiguously a drag. Same 6px threshold as dnd-kit's sensor.
        if (!moved && Math.hypot(dx, dy) < 6) return
        if (!moved) {
          moved = true
          setPanning(true)
        }
        element.scrollLeft = startLeft - dx
        element.scrollTop = startTop - dy
      }

      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        setPanning(false)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [ignoreSelector]
  )

  return { onPointerDown, panning }
}
