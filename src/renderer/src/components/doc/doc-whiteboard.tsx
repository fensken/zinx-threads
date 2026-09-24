import { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'

import { Spinner } from '@renderer/components/ui/spinner'
import { parseScene } from '@renderer/lib/excalidraw-scene'

/**
 * A `/whiteboard` block — an Excalidraw canvas embedded in a doc.
 *
 * It reuses the same `DocExcalidrawCanvas` a course chapter would, so a diagram drawn in a
 * doc behaves identically anywhere else it appears: a preview card you click to open
 * full-screen, read-only for viewers, theme-aware.
 *
 * Excalidraw is a large dependency, so it is `React.lazy`-loaded — a doc with no whiteboard
 * never pays for it.
 */

const DocExcalidrawCanvas = lazy(() =>
  import('@renderer/components/doc/doc-excalidraw-canvas').then((module) => ({
    default: module.DocExcalidrawCanvas
  }))
)

/**
 * Excalidraw fires `onChange` on every pointer move while drawing. Each write here is a
 * document transaction that also restarts the doc's autosave debounce, so it is throttled
 * hard — a stroke should cost one save, not two hundred.
 */
const PERSIST_DEBOUNCE_MS = 1200

export const WhiteboardNode = Node.create({
  name: 'whiteboard',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      // A JSON array of Excalidraw elements — the SAME format the `whiteboards` table
      // stores, so a drawing can move between a doc block and its own channel with no
      // conversion. Only the elements are kept: `appState` holds transient view state
      // (scroll, zoom, current tool) that would otherwise churn the document on every pan.
      data: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-scene'),
        renderHTML: (attributes) =>
          attributes.data ? { 'data-scene': attributes.data as string } : {}
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-whiteboard]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-whiteboard': '' })]
  },

  addNodeView() {
    // NO custom `stopEvent`. TipTap's default already does the right thing for an
    // interactive node view: it returns true for BUTTON / INPUT / SELECT / TEXTAREA targets
    // (so "Open Editor" is ProseMirror's business to ignore) while still letting
    // ProseMirror select the node, run drag handling, and fire the `mousemove` that drives
    // the gutter drag handle.
    //
    // Overriding it is what broke this: a blanket `() => true` also swallowed the events
    // ProseMirror needs to place a NodeSelection, so the browser fell back to putting the
    // caret elsewhere — and scrolled there.
    return ReactNodeViewRenderer(WhiteboardView)
  }
})

function WhiteboardView({ node, updateAttributes, editor }: NodeViewProps): React.JSX.Element {
  const raw = (node.attrs.data as string | null) ?? null
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Excalidraw treats `initialData` as a mount-time prop, so this is parsed once per stored
  // value rather than rebuilt on every render. `parseScene` is defensive: a corrupt scene
  // opens as an empty canvas instead of throwing inside a render path and blanking the doc.
  const initialData = useMemo(() => {
    const elements = parseScene(raw)
    // Elements are stored opaquely (`readonly unknown[]`) and handed straight back to
    // Excalidraw — cast to its own element type at the boundary rather than inspecting them.
    return elements.length > 0
      ? { elements: elements as ExcalidrawInitialDataState['elements'] }
      : undefined
  }, [raw])

  const handleChange = useCallback(
    (elements: readonly unknown[]) => {
      if (!editor.isEditable) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        // Drop Excalidraw's soft-deleted elements: it keeps tombstones in memory for undo,
        // and persisting them grows the scene forever.
        const live = (elements as Array<{ isDeleted?: boolean }>).filter(
          (element) => !element?.isDeleted
        )
        updateAttributes({ data: JSON.stringify(live) })
      }, PERSIST_DEBOUNCE_MS)
    },
    [editor, updateAttributes]
  )

  // Drop the pending write if the node goes away mid-debounce, so a torn-down view can't
  // dispatch a transaction into a dead editor.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    // No event handling here either — ProseMirror's default node-view behaviour selects this
    // block on click, which is what keeps the caret (and the scroll position) from wandering
    // off elsewhere in the document.
    <NodeViewWrapper className="zinx-whiteboard" contentEditable={false}>
      <Suspense
        fallback={
          <div className="flex h-[calc(12rem+2.25rem)] items-center justify-center rounded-lg border bg-muted/30 sm:h-[calc(14rem+2.25rem)]">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        }
      >
        <DocExcalidrawCanvas
          readOnly={!editor.isEditable}
          initialData={initialData}
          onChange={(elements) => handleChange(elements)}
          className="w-full"
        />
      </Suspense>
    </NodeViewWrapper>
  )
}
