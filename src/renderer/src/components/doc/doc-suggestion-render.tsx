import { ReactRenderer, type Editor } from '@tiptap/react'

import {
  DocSuggestionMenu,
  MENU_MAX_HEIGHT,
  MENU_WIDTH,
  type SuggestionMenuHandle
} from '@renderer/components/doc/doc-suggestion-menu'
import type { SuggestionEntry } from '@renderer/lib/tiptap-suggestion'

/** Gap between the caret and the menu. */
const GAP = 8

/** Position the floating menu against the caret rect, flipping when space is tight. */
function positionSuggestionMenu(element: HTMLElement, rect: DOMRect | null): void {
  if (!rect) {
    element.style.visibility = 'hidden'
    return
  }
  const spaceBelow = window.innerHeight - rect.bottom
  const placeBelow = spaceBelow >= MENU_MAX_HEIGHT || spaceBelow >= rect.top

  element.style.visibility = 'visible'
  element.style.position = 'fixed'
  element.style.zIndex = '50'
  element.style.left = `${Math.max(GAP, Math.min(rect.left, window.innerWidth - MENU_WIDTH - GAP))}px`

  if (placeBelow) {
    element.style.top = `${rect.bottom + GAP}px`
    element.style.bottom = ''
  } else {
    element.style.bottom = `${window.innerHeight - rect.top + GAP}px`
    element.style.top = ''
  }
}

/**
 * `render()` for every suggestion trigger in the doc editor (`/`, `@`, `#`).
 *
 * TipTap's documented pattern: the plugin owns a `ReactRenderer` whose element is appended
 * to `document.body`, and keyboard events go straight into the component through its ref.
 * Two properties matter here, and neither holds if the menu's state is lifted into the
 * editor component (as the chat composer's is):
 *
 *  1. **The menu is outside the editor's React tree**, so nothing the editor re-renders —
 *     hovering a block and moving the drag handle, an autosave landing — can remount it.
 *  2. **Keys reach it synchronously**, so `onKeyDown` returns the menu's own verdict in the
 *     same tick and ProseMirror knows whether the key was consumed. Round-tripping through
 *     React state would make Enter and the arrows race the next render.
 */

interface SuggestionRenderProps {
  items: SuggestionEntry[]
  command: (entry: SuggestionEntry) => void
  clientRect?: (() => DOMRect | null) | null
  editor: Editor
}

export function makeSuggestionRender() {
  return () => {
    let renderer: ReactRenderer<SuggestionMenuHandle> | null = null

    const place = (props: SuggestionRenderProps): void => {
      if (!renderer) return
      positionSuggestionMenu(renderer.element as HTMLElement, props.clientRect?.() ?? null)
    }

    const teardown = (): void => {
      renderer?.destroy()
      renderer?.element.remove()
      renderer = null
    }

    return {
      onStart: (props: SuggestionRenderProps) => {
        renderer = new ReactRenderer(DocSuggestionMenu, {
          props: { items: props.items, command: props.command },
          editor: props.editor
        })
        const element = renderer.element as HTMLElement
        // Hidden until positioned, so it never flashes at 0,0 on open.
        element.style.visibility = 'hidden'
        document.body.appendChild(element)
        place(props)
      },

      onUpdate: (props: SuggestionRenderProps) => {
        renderer?.updateProps({ items: props.items, command: props.command })
        place(props)
      },

      onKeyDown: (props: { event: KeyboardEvent }) => {
        if (props.event.key === 'Escape') {
          teardown()
          return true
        }
        return renderer?.ref?.onKeyDown(props.event) ?? false
      },

      onExit: teardown
    }
  }
}
