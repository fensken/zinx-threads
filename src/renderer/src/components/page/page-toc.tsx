import { useCallback, useEffect, useState } from 'react'
import { useEditorChange } from '@blocknote/react'
import { cn } from '@renderer/lib/utils'
import type { PageEditorInstance } from '@renderer/components/page/page-schema'

/** A heading in the document, flattened out of the (possibly nested) block tree. */
interface TocHeading {
  id: string
  /** 1-based; BlockNote's default heading levels are 1–3. */
  level: number
  text: string
}

/** Deepest level we indent. Beyond this everything sits at the same depth rather
 *  than marching off the right edge of a 224px rail. */
const MAX_DEPTH = 3

/** How far below the container's top edge a heading must be to count as "past". */
const ACTIVE_OFFSET_PX = 120

/** Flatten a block's inline content to plain text. BlockNote gives `string` for
 *  simple content and an inline-content array once marks or links are involved. */
function blockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((node) => {
      const item = node as { type?: string; text?: string; content?: unknown }
      if (typeof item.text === 'string') return item.text
      // Links wrap their own inline content.
      if (item.content) return blockText(item.content)
      return ''
    })
    .join('')
}

/** Depth-first, so a heading nested in a toggle or a column still lists in
 *  document order. */
function collectHeadings(blocks: readonly unknown[]): TocHeading[] {
  const out: TocHeading[] = []
  for (const block of blocks) {
    const b = block as {
      id?: string
      type?: string
      props?: { level?: number }
      content?: unknown
      children?: unknown[]
    }
    if (b.type === 'heading' && b.id) {
      const text = blockText(b.content).trim()
      if (text) out.push({ id: b.id, level: b.props?.level ?? 1, text })
    }
    if (b.children?.length) out.push(...collectHeadings(b.children))
  }
  return out
}

function findBlock(scroller: HTMLElement, id: string): HTMLElement | null {
  return scroller.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
}

/** Notion-style table of contents: a rail of dashes pinned beside the page, which
 *  expands into the heading list on hover. Indentation follows heading level; the
 *  heading you're reading is highlighted, and clicking one scrolls to it.
 *
 *  Renders nothing until the document has a heading. Must be a sibling of the
 *  scroll container, not a child — an `absolute` child of a scrolling element
 *  scrolls away with the content. */
export function PageToc({
  editor,
  scrollRef
}: {
  editor: PageEditorInstance
  scrollRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const [headings, setHeadings] = useState<TocHeading[]>(() => collectHeadings(editor.document))
  const [activeId, setActiveId] = useState<string | null>(null)

  // Event-driven, so this never fights a render.
  useEditorChange(() => setHeadings(collectHeadings(editor.document)), editor)

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || headings.length === 0) return

    let frame = 0
    const update = (): void => {
      frame = 0
      const threshold = scroller.getBoundingClientRect().top + ACTIVE_OFFSET_PX
      let current = headings[0]?.id ?? null
      for (const heading of headings) {
        const node = findBlock(scroller, heading.id)
        if (node && node.getBoundingClientRect().top <= threshold) current = heading.id
      }
      setActiveId(current)
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    // Deferred rather than called inline: a synchronous `setState` in an effect
    // body is a cascading render.
    frame = requestAnimationFrame(update)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [headings, scrollRef])

  const jumpTo = useCallback(
    (id: string) => {
      const scroller = scrollRef.current
      const node = scroller && findBlock(scroller, id)
      if (!scroller || !node) return
      // Manual, rather than `scrollIntoView`: that also scrolls every ancestor,
      // which would drag the whole app shell around.
      const delta = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      scroller.scrollTo({ top: scroller.scrollTop + delta - 24, behavior: 'smooth' })
    },
    [scrollRef]
  )

  if (headings.length === 0) return null

  return (
    // Hidden until the *content column* is wide enough for the rail to sit beside
    // the prose — a viewport breakpoint would be wrong, since the sidebar and the
    // members panel both eat into this area independently. (Needs `@container` on
    // the parent.) The expanded panel is allowed to overlay the text, as Notion's does.
    <div className="group/toc absolute top-1/2 right-4 z-10 hidden -translate-y-1/2 @[54rem]:block">
      {/* Collapsed: one dash per heading, its width encoding the level. */}
      <div className="no-scrollbar flex max-h-[60dvh] flex-col items-end gap-2 overflow-hidden py-1 transition-opacity group-hover/toc:opacity-0">
        {headings.map((heading) => (
          <span
            key={heading.id}
            className={cn(
              'h-0.5 shrink-0 rounded-full transition-colors',
              heading.level <= 1 ? 'w-6' : heading.level === 2 ? 'w-4' : 'w-3',
              activeId === heading.id ? 'bg-foreground' : 'bg-muted-foreground/40'
            )}
          />
        ))}
      </div>

      {/* Expanded on hover, capped so a long document scrolls instead of running
          off the viewport. */}
      <div className="no-scrollbar pointer-events-none absolute top-1/2 right-0 max-h-[60dvh] w-56 -translate-y-1/2 overflow-y-auto rounded-lg border bg-popover p-1.5 opacity-0 shadow-xl transition-opacity group-hover/toc:pointer-events-auto group-hover/toc:opacity-100">
        <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          On this page
        </p>
        {headings.map((heading) => (
          <button
            key={heading.id}
            type="button"
            onClick={() => jumpTo(heading.id)}
            style={{ paddingLeft: 8 + (Math.min(heading.level, MAX_DEPTH) - 1) * 12 }}
            className={cn(
              'block w-full truncate rounded-md py-1 pr-2 text-left text-[13px] transition-colors',
              activeId === heading.id
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
            title={heading.text}
          >
            {heading.text}
          </button>
        ))}
      </div>
    </div>
  )
}
