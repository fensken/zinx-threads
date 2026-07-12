import type { ChainedCommands } from '@tiptap/react'
import type { SuggestionApplyContext, SuggestionEntry } from '@renderer/lib/tiptap-suggestion'

/** `/` commands. Like `zinx-os`'s `SLASH_COMMANDS`, these are overwhelmingly
 *  *formatting* actions rather than text macros — the point of `/` is to reach
 *  a list, a quote or a code block without leaving the keyboard.
 *
 *  Our composer is WYSIWYG, so each entry runs an editor command instead of
 *  inserting a Markdown template. Headings, tables and math are absent because
 *  the composer doesn't enable those nodes. */

const SHRUG = '¯\\_(ツ)_/¯'
const TABLEFLIP = '(╯°□°）╯︵ ┻━┻'
const UNFLIP = '┬─┬ ノ( ゜-゜ノ)'

/** Every command first removes the typed `/query`, then acts. */
function clear({ editor, range }: SuggestionApplyContext): ChainedCommands {
  return editor.chain().focus().deleteRange(range)
}

export const DEFAULT_SLASH_COMMANDS: SuggestionEntry[] = [
  // ── Lists ──
  {
    id: 'bullet-list',
    label: 'Bulleted list',
    description: 'Start an unordered list',
    group: 'Lists',
    keywords: ['bullet', 'unordered', 'ul', 'list'],
    apply: (context) => clear(context).toggleBulletList().run()
  },
  {
    id: 'numbered-list',
    label: 'Numbered list',
    description: 'Start an ordered list',
    group: 'Lists',
    keywords: ['number', 'ordered', 'ol', 'list'],
    apply: (context) => clear(context).toggleOrderedList().run()
  },

  // ── Blocks ──
  {
    id: 'quote',
    label: 'Blockquote',
    description: 'Quote a passage',
    group: 'Blocks',
    keywords: ['quote', 'blockquote', 'citation'],
    apply: (context) => clear(context).toggleBlockquote().run()
  },
  {
    id: 'code-block',
    label: 'Code block',
    description: 'Insert a fenced code block',
    group: 'Blocks',
    keywords: ['code', 'snippet', 'block', 'fence'],
    apply: (context) => clear(context).toggleCodeBlock().run()
  },

  // ── Text ──
  {
    id: 'bold',
    label: 'Bold',
    description: 'Bold the text you type next',
    group: 'Text',
    keywords: ['bold', 'strong'],
    apply: (context) => clear(context).toggleBold().run()
  },
  {
    id: 'italic',
    label: 'Italic',
    description: 'Italicise the text you type next',
    group: 'Text',
    keywords: ['italic', 'emphasis'],
    apply: (context) => clear(context).toggleItalic().run()
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    description: 'Strike the text you type next',
    group: 'Text',
    keywords: ['strike', 'strikethrough'],
    apply: (context) => clear(context).toggleStrike().run()
  },
  {
    id: 'inline-code',
    label: 'Inline code',
    description: 'Format the text you type next as code',
    group: 'Text',
    keywords: ['code', 'inline', 'mono'],
    apply: (context) => clear(context).toggleCode().run()
  },

  // ── Insert ──
  {
    id: 'emoji',
    label: 'Emoji',
    description: 'Pick an emoji',
    group: 'Insert',
    keywords: ['emoji', 'smiley', 'reaction'],
    apply: (context) => {
      clear(context).run()
      context.openEmoji()
    }
  },
  {
    id: 'gif',
    label: 'GIF',
    description: 'Search and send a GIF',
    group: 'Insert',
    keywords: ['gif', 'giphy', 'klipy'],
    apply: (context) => {
      clear(context).run()
      context.openGif()
    }
  },

  // ── Fun ──
  {
    id: 'shrug',
    label: 'Shrug',
    description: SHRUG,
    group: 'Fun',
    keywords: ['shrug'],
    apply: (context) => clear(context).insertContent(SHRUG).run()
  },
  {
    id: 'tableflip',
    label: 'Table flip',
    description: TABLEFLIP,
    group: 'Fun',
    keywords: ['table', 'flip', 'rage'],
    apply: (context) => clear(context).insertContent(TABLEFLIP).run()
  },
  {
    id: 'unflip',
    label: 'Table unflip',
    description: UNFLIP,
    group: 'Fun',
    keywords: ['unflip', 'table'],
    apply: (context) => clear(context).insertContent(UNFLIP).run()
  }
]
