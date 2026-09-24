import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref
} from 'react'

import { SuggestionGlyph } from '@renderer/components/common/suggestion-glyph'
import type { SuggestionEntry } from '@renderer/lib/tiptap-suggestion'
import { cn } from '@renderer/lib/utils'

/**
 * The popup shared by the doc editor's three triggers (`/`, `@`, `#`).
 *
 * It owns its highlighted index and exposes `onKeyDown` through a ref, which the
 * ProseMirror plugin calls directly — TipTap's documented suggestion pattern, and NOT the
 * chat composer's lifted-state approach. The difference matters here for one reason the
 * composer doesn't have: this editor has a **drag handle**, whose `onNodeChange` fires as
 * the pointer crosses blocks. Lifting the menu's state into the editor component would make
 * merely moving the mouse re-render the menu, so it would flicker and vanish as you reached
 * for it, and a click could land after a re-render had already replaced `command`.
 *
 * Owning state here means the menu re-renders only when the menu changes.
 */

/** Shared with `positionSuggestionMenu` (`doc-suggestion-render.tsx`), which places the
 *  element this component renders into. */
export const MENU_WIDTH = 320
export const MENU_MAX_HEIGHT = 400

export interface SuggestionMenuHandle {
  /** True when the key was consumed, so ProseMirror knows not to act on it. */
  onKeyDown: (event: KeyboardEvent) => boolean
}

export const DocSuggestionMenu = forwardRef(function DocSuggestionMenu(
  { items, command }: { items: SuggestionEntry[]; command: (entry: SuggestionEntry) => void },
  ref: Ref<SuggestionMenuHandle>
): React.JSX.Element | null {
  const [selected, setSelected] = useState(0)
  const activeRef = useRef<HTMLButtonElement>(null)

  // A new result set invalidates the old highlight. Adjusting state during render is
  // React's documented way to reset state when a prop changes — it re-renders before
  // paint, so the wrong row is never briefly highlighted.
  const [prevItems, setPrevItems] = useState(items)
  if (items !== prevItems) {
    setPrevItems(items)
    setSelected(0)
  }

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const select = useCallback(
    (index: number) => {
      const entry = items[index]
      if (entry) command(entry)
    },
    [items, command]
  )

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (items.length === 0) return false
        if (event.key === 'ArrowDown') {
          setSelected((current) => (current + 1) % items.length)
          return true
        }
        if (event.key === 'ArrowUp') {
          setSelected((current) => (current - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'Home') {
          setSelected(0)
          return true
        }
        if (event.key === 'End') {
          setSelected(items.length - 1)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          select(selected)
          return true
        }
        return false
      }
    }),
    // `selected` is read inside, so the handle must be rebuilt when it changes —
    // otherwise Enter fires against a stale index.
    [items, selected, select]
  )

  if (items.length === 0) return null

  return (
    <div
      className="no-scrollbar overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl"
      style={{ width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT }}
      // The menu lives outside the editor's DOM. Without this, pressing the mouse down
      // here blurs the editor, which collapses the selection and tears the suggestion
      // session down before the click can land.
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((entry, index) => {
        // Entries arrive pre-grouped, so a header is just "differs from the previous one".
        const showHeader = entry.group && entry.group !== items[index - 1]?.group
        return (
          <div key={entry.id}>
            {showHeader ? (
              <p className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {entry.group}
              </p>
            ) : null}
            <button
              ref={index === selected ? activeRef : undefined}
              type="button"
              onClick={() => select(index)}
              onMouseEnter={() => setSelected(index)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                index === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
              )}
            >
              <SuggestionGlyph entry={entry} className="size-4" avatarClassName="size-5" />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.description ? (
                <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                  {entry.description}
                </span>
              ) : null}
            </button>
          </div>
        )
      })}
    </div>
  )
})
