import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw, exportToSvg } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { ArrowsOut, Eye, PencilSimple } from '@phosphor-icons/react'

import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { useIsDark } from '@renderer/lib/use-is-dark'
import { cn } from '@renderer/lib/utils'

import '@excalidraw/excalidraw/index.css'
import '@renderer/components/whiteboard/whiteboard.css'

/**
 * The doc editor's Excalidraw surface — a **collapsed preview card** that opens the real
 * canvas in a full-screen dialog. Ported from `_zinx`'s `media/excalidraw-canvas.tsx`.
 *
 * Deliberately NOT an inline canvas, which is the obvious-looking design and the wrong one:
 * a live canvas inside a document fights the document for the scroll wheel and for every
 * pointer gesture, and it has to be given an arbitrary height that is wrong for every
 * drawing. The card shows an **SVG snapshot** of the scene — real content, at whatever size
 * the block happens to be — and clicking through gives the drawing the whole window.
 *
 * This is the second module in the app that imports Excalidraw (the other is
 * `whiteboard/whiteboard-view.tsx`, for a `whiteboard` CHANNEL), and like it, **it is only
 * ever reached through `React.lazy`** — see `doc-whiteboard.tsx`. Excalidraw is ~1MB; a doc
 * with no whiteboard block must never pay for it.
 */
export function DocExcalidrawCanvas({
  readOnly = false,
  initialData,
  onChange,
  className
}: {
  readOnly?: boolean
  initialData?: Parameters<typeof Excalidraw>[0]['initialData']
  onChange?: Parameters<typeof Excalidraw>[0]['onChange']
  className?: string
}): React.JSX.Element {
  const isDark = useIsDark()
  const theme = isDark ? 'dark' : 'light'

  const [isExpanded, setIsExpanded] = useState(false)
  const [previewSvg, setPreviewSvg] = useState<string | null>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)

  // Track the latest scene so reopening the dialog restores your edits, not just
  // `initialData` — which is a mount-time prop and stays at whatever was stored.
  const [latestScene, setLatestScene] = useState(initialData)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const generatePreview = useCallback(async (): Promise<void> => {
    const api = apiRef.current
    if (!api) return
    const elements = api.getSceneElements()
    if (elements.length === 0) {
      setPreviewSvg(null)
      return
    }
    try {
      const svg = await exportToSvg({
        elements,
        appState: { ...api.getAppState(), exportWithDarkMode: isDark },
        files: api.getFiles()
      })
      setPreviewSvg(svg.outerHTML)
    } catch {
      // Preview generation failed — keep the previous one rather than blanking the card.
    }
  }, [isDark])

  // Generate the preview on mount when the stored scene has elements, so a saved drawing
  // shows immediately instead of reading as "nothing here".
  const hasGeneratedInitial = useRef(false)
  useEffect(() => {
    if (hasGeneratedInitial.current) return
    if (!initialData || typeof initialData === 'function' || initialData instanceof Promise) return
    if (!initialData.elements || initialData.elements.length === 0) return

    const elements = initialData.elements as ReadonlyArray<{ isDeleted?: boolean }>
    const visible = elements.filter((element) => !element.isDeleted)
    if (visible.length === 0) return
    hasGeneratedInitial.current = true

    exportToSvg({
      elements: visible as Parameters<typeof exportToSvg>[0]['elements'],
      appState: { exportWithDarkMode: isDark },
      files: null
    })
      .then((svg: SVGSVGElement) => setPreviewSvg(svg.outerHTML))
      .catch(() => {})
  }, [initialData, isDark])

  const handleClose = useCallback(async (): Promise<void> => {
    // Snapshot the current scene so reopening restores the latest state.
    const api = apiRef.current
    if (api) {
      const elements = api.getSceneElements().filter((element) => !element.isDeleted)
      if (elements.length > 0) {
        setLatestScene({
          elements: JSON.parse(JSON.stringify(elements)),
          appState: api.getAppState(),
          files: api.getFiles()
        })
      } else {
        setLatestScene(undefined)
      }
    }
    await generatePreview()
    setIsExpanded(false)
  }, [generatePreview])

  return (
    <>
      {/* Collapsed preview card */}
      <div
        className={cn(
          'group relative w-full overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/40',
          className
        )}
      >
        <div className="relative h-48 overflow-hidden bg-muted/30 sm:h-56">
          {previewSvg ? (
            // The SVG comes from Excalidraw's own exporter, not from user input — it is
            // generated in this process from the scene we just read.
            <div
              className="flex h-full w-full items-center justify-center p-4 [&>svg]:max-h-full [&>svg]:max-w-full [&>svg]:object-contain"
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <PencilSimple className="size-8" weight="duotone" />
              <p className="text-xs">{readOnly ? 'No drawing yet' : 'Click to start drawing'}</p>
            </div>
          )}

          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/5 dark:group-hover:bg-white/5">
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5 opacity-0 shadow-md transition-opacity group-hover:opacity-100"
              onClick={() => setIsExpanded(true)}
            >
              {readOnly ? (
                <>
                  <Eye className="size-3.5" weight="bold" />
                  View
                </>
              ) : (
                <>
                  <ArrowsOut className="size-3.5" weight="bold" />
                  Open Editor
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PencilSimple className="size-3.5" weight="duotone" />
            <span>Excalidraw</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {readOnly ? 'Read only' : 'Editable'}
          </span>
        </div>
      </div>

      {/* Expanded editor */}
      <Dialog open={isExpanded} onOpenChange={(open) => !open && void handleClose()}>
        <DialogContent className="flex h-[calc(100dvh-4rem)] max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100dvw-4rem)]">
          <DialogHeader className="sr-only">
            <DialogTitle>Whiteboard</DialogTitle>
            <DialogDescription>
              {readOnly ? 'Viewing whiteboard content' : 'Draw and sketch on the whiteboard'}
            </DialogDescription>
          </DialogHeader>

          <div className="relative h-full min-h-0 w-full flex-1">
            <div className="absolute inset-0">
              <Excalidraw
                theme={theme}
                viewModeEnabled={readOnly}
                initialData={latestScene ?? initialData}
                onChange={onChange}
                excalidrawAPI={(api) => {
                  apiRef.current = api
                  // Refresh after the dialog's animation settles so Excalidraw recalculates
                  // its canvas dimensions — without this, click and draw positions land
                  // offset from the cursor.
                  setTimeout(() => {
                    if (!mountedRef.current) return
                    api.refresh()
                    const elements = api.getSceneElements()
                    if (elements.length > 0) {
                      api.scrollToContent(elements, {
                        fitToViewport: true,
                        viewportZoomFactor: 0.9,
                        maxZoom: 1
                      })
                    }
                  }, 300)
                }}
                UIOptions={{ tools: { image: false } }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default DocExcalidrawCanvas
