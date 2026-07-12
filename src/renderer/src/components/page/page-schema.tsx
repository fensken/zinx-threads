import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  type BlockNoteEditor
} from '@blocknote/core'
import { codeBlockOptions } from '@blocknote/code-block'
import { createReactBlockSpec } from '@blocknote/react'

// The editor's schema + the conversions in and out of it. Split out of
// `page-editor.tsx` so that file exports components only (react-refresh).

/** Notion-style callout (emoji + inline content). Proves the custom-block path;
 *  everything else maps onto BlockNote's built-ins. */
const CalloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: { emoji: { default: '💡' } },
    content: 'inline'
  },
  {
    render: ({ block, contentRef }): React.JSX.Element => (
      <div className="zinx-callout">
        <span className="zinx-callout-emoji" contentEditable={false} suppressContentEditableWarning>
          {block.props.emoji}
        </span>
        <div className="zinx-callout-body" ref={contentRef} />
      </div>
    )
  }
)

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    // Replace the default (unhighlighted) code block with a Shiki-highlighted one.
    // @blocknote/code-block uses Shiki's JS engine + precompiled grammars (no WASM),
    // so it works under our `script-src 'self'` CSP.
    codeBlock: createCodeBlockSpec(codeBlockOptions),
    callout: CalloutBlock()
  }
})

export type PageEditorInstance = BlockNoteEditor<
  typeof schema.blockSchema,
  typeof schema.inlineContentSchema,
  typeof schema.styleSchema
>

export type PartialBlock = typeof schema.PartialBlock

/** What the editor renders: chrome + a BlockNote document (from the Convex `pages` row). */
export interface PageDoc {
  title: string
  icon?: string
  cover?: string
  coverY?: number
  subtitle?: string
  blocks: PartialBlock[]
}

/** True when a serialized document holds nothing a reader would see: no blocks,
 *  or only empty paragraphs.
 *
 *  BlockNote normalises its document on mount (it guarantees a trailing
 *  paragraph), which fires `onChange`. Without this, merely *opening* an untouched
 *  page channel would create its `pages` row and flash the "Saved" pill. Used only
 *  to suppress the very first write — once a row exists, emptying a page must
 *  still save, or deleting all your text wouldn't persist. */
export function isEmptyPageContent(content: string): boolean {
  let blocks: unknown
  try {
    blocks = JSON.parse(content)
  } catch {
    return true
  }
  if (!Array.isArray(blocks)) return true
  return blocks.every((block) => {
    const b = block as { type?: string; content?: unknown[]; children?: unknown[] }
    return b.type === 'paragraph' && !b.content?.length && !b.children?.length
  })
}

/** Parse a stored BlockNote document (`pages.content`).
 *
 *  BlockNote rejects an empty `initialContent` array, so an empty or unparseable
 *  document becomes `undefined` — which makes it start with one blank paragraph.
 *  A corrupt document must not take the editor down with it. */
export function parsePageContent(content: string | undefined): PartialBlock[] | undefined {
  if (!content) return undefined
  try {
    const parsed: unknown = JSON.parse(content)
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined
    return parsed as PartialBlock[]
  } catch {
    console.error('Could not parse the stored page document; starting empty.')
    return undefined
  }
}
