import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState
} from '@excalidraw/excalidraw/types'
import { Check, WarningCircle } from '@phosphor-icons/react'
import { Spinner } from '@renderer/components/ui/spinner'
import { canvasBackground } from '@renderer/lib/excalidraw-theme'
import { parseScene, serializeScene, type SceneElements } from '@renderer/lib/excalidraw-scene'
import { useDebouncedCallback } from '@renderer/lib/use-debounced-callback'
import { useIsDark } from '@renderer/lib/use-is-dark'

import '@excalidraw/excalidraw/index.css'
import '@renderer/components/whiteboard/whiteboard.css'

/**
 * A `whiteboard` channel: an Excalidraw canvas, full-bleed, autosaved.
 *
 * **This is the only module that imports Excalidraw, and it is reached ONLY through
 * `React.lazy`** (see `real-whiteboard-view.tsx` / `local-whiteboard-view.tsx`). Excalidraw
 * is ~1MB; a static import from anywhere non-lazy pulls it into the main bundle and every
 * user pays for it whether or not they ever open a whiteboard. Same trap as BlockNote.
 *
 * Presentational: the scene comes in, edits go out. `real-` / `local-` adapters supply
 * the persistence, exactly as `BoardView` and `PageEditor` do.
 */
export function WhiteboardView({
  /** The serialized scene. **Must already be loaded** — the caller shows the spinner and
   *  only mounts this once it has the real thing. That's not a style preference: the seed
   *  below runs exactly once, so mounting against a placeholder would seed an EMPTY canvas
   *  and then never re-seed, quietly showing a blank board over a saved drawing. */
  elements,
  onSave
}: {
  elements: string
  onSave: (scene: { json: string; count: number }) => Promise<void> | void
}): React.JSX.Element {
  const isDark = useIsDark()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const api = useRef<ExcalidrawImperativeAPI | null>(null)

  // Seeded ONCE, at mount. The caller keys this per channel, so a channel switch remounts
  // and re-seeds; re-seeding on every server echo would yank the canvas out from under
  // whoever is drawing on it.
  const [initial] = useState<SceneElements>(() => parseScene(elements))

  const save = useCallback(
    async (scene: SceneElements): Promise<void> => {
      setStatus('saving')
      try {
        const { json, count } = serializeScene(scene)
        await onSave({ json, count })
        setStatus('saved')
      } catch {
        setStatus('error')
      }
    },
    [onSave]
  )

  // Autosave 1s after the last stroke. `useDebouncedCallback` owns the timer AND the
  // flush-on-unmount, so navigating away mid-stroke still saves the last strokes — no
  // hand-rolled dirty/ref juggling. A whiteboard that never fired `onChange` has nothing
  // pending, so an unmount can't save an empty canvas over a real one.
  const scheduleSave = useDebouncedCallback<SceneElements>((scene) => void save(scene), 1000)

  // Keep the canvas on the theme's surface when the theme flips. The scene is seeded once,
  // so this is the only thing that re-applies it. See `lib/excalidraw-theme.ts` for why the
  // value isn't simply `--card` in dark mode.
  useEffect(() => {
    const background = canvasBackground(isDark)
    if (background) api.current?.updateScene({ appState: { viewBackgroundColor: background } })
  }, [isDark])

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      {/* The canvas background comes from the THEME (`--card` — the same surface every other
          channel's content sits on), not from Excalidraw's white default. In dark mode that
          takes real work: Excalidraw darkens by *inverting the whole canvas with a CSS
          filter*, so a colour handed to it comes back flipped. `canvasBackground()` passes
          the **pre-image** — the colour that lands on our token once their filter has run.
          The alternative was a stark white board inside a cream app that stayed white through
          every theme change. */}
      <Excalidraw
        excalidrawAPI={(instance) => (api.current = instance)}
        theme={isDark ? 'dark' : 'light'}
        initialData={{
          // Elements are stored opaquely (`readonly unknown[]`) and handed straight back to
          // Excalidraw — cast to its own element type at the boundary rather than inspecting them.
          elements: initial as ExcalidrawInitialDataState['elements'],
          appState: { viewBackgroundColor: canvasBackground(isDark) ?? undefined },
          scrollToContent: true
        }}
        onChange={(next) => {
          // A no-op when already idle (React bails on an identical state), so this doesn't
          // re-render on every pointer move — it just clears a lingering "Saved" once you draw again.
          setStatus('idle')
          scheduleSave(next)
        }}
      />
      <SaveStatus status={status} />
    </div>
  )
}

/** Bottom-left, clear of Excalidraw's own chrome (its toolbar is top-centre, the zoom
 *  controls bottom-left on desktop… so: bottom-RIGHT, above the help button). */
function SaveStatus({
  status
}: {
  status: 'idle' | 'saving' | 'saved' | 'error'
}): React.JSX.Element | null {
  if (status === 'idle') return null
  return (
    <div className="pointer-events-none absolute right-4 bottom-16 z-10 flex items-center gap-1.5 rounded-md bg-card/90 px-2 py-1 text-xs shadow-sm">
      {status === 'saving' ? (
        <>
          <Spinner className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Saving…</span>
        </>
      ) : status === 'saved' ? (
        <>
          <Check className="size-3.5 text-muted-foreground" weight="bold" />
          <span className="text-muted-foreground">Saved</span>
        </>
      ) : (
        <>
          <WarningCircle className="size-3.5 text-destructive" weight="fill" />
          {/* Never auto-dismissed: unsaved work is not something to let scroll past. */}
          <span className="font-medium text-destructive">Not saved</span>
        </>
      )}
    </div>
  )
}
