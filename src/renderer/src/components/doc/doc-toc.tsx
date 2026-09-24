import { useEffect, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/react'

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

/** How far below the scroller's top a heading counts as "current". */
const ACTIVE_OFFSET_PX = 120
/** Indentation caps out here so deep nesting stays readable. */
const MAX_DEPTH = 3

interface TocHeading {
  /** Document position — used both as a key and to locate the DOM node. */
  pos: number
  level: number
  text: string
}

/** Walk the ProseMirror document for headings, in document order. */
function collectHeadings(editor: Editor): TocHeading[] {
  const out: TocHeading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim()
      if (text) out.push({ pos, level: Number(node.attrs.level ?? 1), text })
    }
    return true
  })
  return out
}

/** Notion's right-hand rail: a stack of dashes (one per heading, width encoding depth) that
 *  expands into a real outline on hover. */
export function DocToc({
  editor,
  scrollRef
}: {
  editor: Editor
  scrollRef: RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const [headings, setHeadings] = useState<TocHeading[]>(() => collectHeadings(editor))
  const [activeId, setActiveId] = useState<number | null>(null)

  // Derived from the document, so it updates as you type.
  useEffect(() => {
    const update = (): void => setHeadings(collectHeadings(editor))
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor])

  // Track the current heading against the scroll container, rAF-throttled.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || headings.length === 0) return

    let frame = 0
    const update = (): void => {
      frame = 0
      const threshold = scroller.getBoundingClientRect().top + ACTIVE_OFFSET_PX
      let current = headings[0]?.pos ?? null
      for (const heading of headings) {
        const node = editor.view.nodeDOM(heading.pos) as HTMLElement | null
        if (node?.getBoundingClientRect && node.getBoundingClientRect().top <= threshold) {
          current = heading.pos
        }
      }
      setActiveId(current)
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    frame = requestAnimationFrame(update)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [headings, scrollRef, editor])

  if (headings.length === 0) return null

  const jumpTo = (pos: number): void => {
    const scroller = scrollRef.current
    const node = editor.view.nodeDOM(pos) as HTMLElement | null
    if (!scroller || !node?.getBoundingClientRect) return
    // A manual scroll, not `scrollIntoView` — that scrolls every ancestor and would drag
    // the whole app shell with it.
    const delta = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTo({ top: scroller.scrollTop + delta - 24, behavior: 'smooth' })
  }

  return (
    <div className="group/toc absolute top-1/2 right-4 z-10 hidden -translate-y-1/2 @[54rem]:block">
      {/* Collapsed: one dash per heading; width encodes depth. */}
      <div className="no-scrollbar flex max-h-[60dvh] flex-col items-end gap-2 overflow-hidden py-1 transition-opacity group-hover/toc:opacity-0">
        {headings.map((heading) => (
          <span
            key={heading.pos}
            className={cn(
              'h-0.5 shrink-0 rounded-full transition-colors',
              heading.level <= 1 ? 'w-6' : heading.level === 2 ? 'w-4' : 'w-3',
              activeId === heading.pos ? 'bg-foreground' : 'bg-muted-foreground/40'
            )}
          />
        ))}
      </div>

      {/* Expanded on hover, overlaying the prose — Notion's. */}
      <div className="no-scrollbar pointer-events-none absolute top-1/2 right-0 max-h-[60dvh] w-56 -translate-y-1/2 overflow-y-auto rounded-lg border bg-popover p-1.5 opacity-0 shadow-xl transition-opacity group-hover/toc:pointer-events-auto group-hover/toc:opacity-100">
        <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          On this page
        </p>
        {headings.map((heading) => (
          <Button
            key={heading.pos}
            type="button"
            variant="ghost"
            title={heading.text}
            onClick={() => jumpTo(heading.pos)}
            style={{ paddingLeft: 8 + (Math.min(heading.level, MAX_DEPTH) - 1) * 12 }}
            className={cn(
              'block h-auto w-full justify-start truncate rounded-md py-1 pr-2 text-left text-[13px] font-normal',
              activeId === heading.pos
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground'
            )}
          >
            {heading.text}
          </Button>
        ))}
      </div>
    </div>
  )
}
