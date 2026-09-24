import type { AnyExtension, JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import TextAlign from '@tiptap/extension-text-align'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { BackgroundColor, Color, TextStyle } from '@tiptap/extension-text-style'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'

import { DocCodeBlock } from '@renderer/components/doc/doc-code-block'
import { CalloutNode, EmbedNode } from '@renderer/components/doc/doc-blocks'
import { Column, ColumnBlock } from '@renderer/components/doc/doc-columns'
import { WhiteboardNode } from '@renderer/components/doc/doc-whiteboard'
import { AttachmentNode, ImageBlock } from '@renderer/components/doc/doc-media'
import { DocMentionNode } from '@renderer/components/doc/doc-mention'
import { createDocSlashCommands } from '@renderer/components/doc/doc-slash-commands'
import { makeSuggestionRender } from '@renderer/components/doc/doc-suggestion-render'
import {
  channelMentionEntries,
  userMentionEntries,
  type MentionChannel,
  type MentionMember
} from '@renderer/lib/tiptap-mention'
import {
  SuggestionMenu,
  filterSuggestions,
  type SuggestionApplyContext,
  type SuggestionEntry
} from '@renderer/lib/tiptap-suggestion'

/**
 * The doc editor's schema — every block it supports, in one list.
 *
 * The `@` and `#` catalogues are read through a **ref**, not captured by value. The editor
 * is built once (see `buildDocExtensions`'s memo contract below), so closing over today's
 * member list would leave the autocomplete permanently stale when the directory query
 * lands a moment later. The chat composer routes its sources through a ref for exactly the
 * same reason.
 */

export interface DocSources {
  members: MentionMember[]
  channels: MentionChannel[]
  canModerate: boolean
}

interface BuildOptions {
  /** Live `@`/`#` catalogues. Read at menu-open time, never captured. */
  sources: { current: DocSources }
  /** Uploads any file (image, video, audio, document) and resolves its durable URL. */
  upload: (file: File) => Promise<string>
  /** Opens the emoji picker at the given caret rect (`/emoji`). */
  openEmoji: (anchor?: DOMRect) => void
  /** Opens the host's link dialog (`/bookmark`) — `window.prompt` is unavailable here. */
  openBookmark: () => void
}

/** The context every suggestion `apply` receives. The media blocks carry their own inline
 *  pickers, so `openGif` has nothing to do here. */
function applyContext(
  opts: BuildOptions,
  editor: SuggestionApplyContext['editor'],
  range: SuggestionApplyContext['range']
): SuggestionApplyContext {
  return {
    editor,
    range,
    openGif: () => {},
    openEmoji: opts.openEmoji,
    openBookmark: opts.openBookmark
  }
}

/**
 * **Call this from a `useMemo` whose dependencies are genuinely stable.** That is
 * correctness, not performance: `useEditor` compares its options with `compareOptions`,
 * which checks `extensions` by IDENTITY, element by element. This function mints fresh
 * instances on every call, so calling it inline makes that comparison fail on EVERY render
 * — and TipTap responds by calling `editor.setOptions(...)`, which rebuilds the schema and
 * destroys and recreates every node view. That is what tears down a whiteboard canvas
 * mid-stroke and disposes a video player mid-load.
 */
export function buildDocExtensions(opts: BuildOptions): AnyExtension[] {
  const slashCommands = createDocSlashCommands()
  const render = makeSuggestionRender()

  /** One `command` shape for all three triggers. */
  const command = ({
    editor,
    range,
    props
  }: {
    editor: SuggestionApplyContext['editor']
    range: SuggestionApplyContext['range']
    props: SuggestionEntry
  }): void => props.apply(applyContext(opts, editor, range))

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      codeBlock: false, // replaced by DocCodeBlock (lowlight + a language picker)
      link: { openOnClick: false, autolink: true }
    }),
    DocCodeBlock,

    // ── Marks the bubble menu drives ──
    TextStyle,
    Color,
    BackgroundColor,
    Superscript,
    Subscript,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),

    // ── Blocks ──
    ImageBlock.configure({ upload: opts.upload }),
    AttachmentNode.configure({ upload: opts.upload }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // Toggle list. `persist: false` — whether a section is open is a per-READER thing, not
    // something to write into everyone's document.
    Details.configure({ persist: false, HTMLAttributes: { class: 'zinx-toggle' } }),
    DetailsSummary,
    DetailsContent,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    CalloutNode,
    EmbedNode,
    ColumnBlock,
    Column,
    WhiteboardNode,
    DocMentionNode,
    Placeholder.configure({
      placeholder: ({ node }: { node: { type: { name: string } } }) => {
        if (node.type.name === 'heading') return 'Heading'
        if (node.type.name === 'detailsSummary') return 'Toggle'
        return "Type '/' for commands, '@' to mention…"
      }
    }),

    // ── `/` blocks ──
    SuggestionMenu.extend({ name: 'docSlash' }).configure({
      char: '/',
      startOfLine: false,
      suggestion: {
        // No cap: every block should be reachable, and the menu scrolls.
        items: ({ query }: { query: string }) =>
          filterSuggestions(slashCommands, query, Number.POSITIVE_INFINITY),
        command,
        render
      }
    }),

    // ── `@` people + role groups ──
    SuggestionMenu.extend({ name: 'docMention' }).configure({
      char: '@',
      startOfLine: false,
      suggestion: {
        items: ({ query }: { query: string }) => {
          const { members, canModerate } = opts.sources.current
          // `@silent` is a *message* directive — there is nothing to send from a document,
          // so the doc's `@` menu is people and roles only.
          return userMentionEntries(query, members, { canModerate }).filter(
            (entry) => !entry.id.startsWith('directive:')
          )
        },
        command,
        render
      }
    }),

    // ── `#` channels ──
    SuggestionMenu.extend({ name: 'docChannel' }).configure({
      char: '#',
      startOfLine: false,
      suggestion: {
        items: ({ query }: { query: string }) =>
          channelMentionEntries(query, opts.sources.current.channels),
        command,
        render
      }
    })
  ]
}

/**
 * Parse stored JSON into TipTap content, or `undefined` when there is nothing readable.
 *
 * **The autosave gate keys on this returning a value**, not on whether a row exists — a
 * document that opens blank because its stored content couldn't be parsed must not have
 * that blank saved back over it. (See `convex/docs.ts` `EMPTY_DOC`: the two halves of that
 * rule are "the reader refuses garbage" and "no writer ever produces garbage".)
 */
export function parseDocContent(content: string | null | undefined): JSONContent | undefined {
  if (!content) return undefined
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'doc') {
      return parsed as JSONContent
    }
    // Anything else isn't a TipTap document — open empty rather than crash the channel.
    // The original JSON is left untouched in the row.
    return undefined
  } catch {
    return undefined
  }
}

/** True when a serialized document holds nothing but empty paragraphs. */
export function isEmptyDocContent(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as JSONContent
    const nodes = parsed?.content
    if (!Array.isArray(nodes) || nodes.length === 0) return true
    return nodes.every((node) => node.type === 'paragraph' && !node.content?.length)
  } catch {
    return true
  }
}
