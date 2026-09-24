import {
  Browser,
  CaretRight,
  CheckSquare,
  CodeBlock,
  Columns,
  FilmSlate,
  GifIcon,
  Image as ImageIcon,
  Lightbulb,
  ListBullets,
  ListNumbers,
  Minus,
  MusicNotes,
  Paperclip,
  PencilLine,
  Quotes,
  Smiley,
  Table,
  TextHFour,
  TextHOne,
  TextHThree,
  TextHTwo,
  TextT,
  VideoCamera
} from '@phosphor-icons/react'

import type { ChainedCommands } from '@tiptap/core'

import type { AttachmentKind } from '@renderer/components/doc/doc-media'
import type { SuggestionApplyContext, SuggestionEntry } from '@renderer/lib/tiptap-suggestion'

/**
 * `/` commands for the doc editor — the block menu.
 *
 * Entries are listed in GROUP ORDER, and the menu prints a header whenever the group
 * changes; keeping same-group items adjacent here is what stops a header printing twice.
 *
 * Unlike the chat composer's `/` commands (a handful of formatting toggles), these are the
 * **block palette** — every block the schema supports should be reachable from here, which
 * is why the menu doesn't cap the list and scrolls instead.
 */

const ICON = 'size-4'

/** Every command first removes the typed `/query`, then acts. */
function clear({ editor, range }: SuggestionApplyContext): ChainedCommands {
  return editor.chain().focus().deleteRange(range)
}

/** Insert an empty video/audio/file block — they share one node (`doc-media.tsx`). */
function emptyAttachment(kind: AttachmentKind): { type: string; attrs: { kind: AttachmentKind } } {
  return { type: 'attachment', attrs: { kind } }
}

export function createDocSlashCommands(): SuggestionEntry[] {
  return [
    // ── Text ──
    {
      id: 'text',
      label: 'Text',
      description: 'Plain paragraph',
      group: 'Text',
      keywords: ['text', 'paragraph', 'p', 'body'],
      iconNode: <TextT className={ICON} />,
      apply: (c) => clear(c).setParagraph().run()
    },
    {
      id: 'h1',
      label: 'Heading 1',
      description: 'Large section heading',
      group: 'Text',
      keywords: ['heading', 'h1', 'title', 'large'],
      iconNode: <TextHOne className={ICON} />,
      apply: (c) => clear(c).toggleHeading({ level: 1 }).run()
    },
    {
      id: 'h2',
      label: 'Heading 2',
      description: 'Medium section heading',
      group: 'Text',
      keywords: ['heading', 'h2', 'subtitle'],
      iconNode: <TextHTwo className={ICON} />,
      apply: (c) => clear(c).toggleHeading({ level: 2 }).run()
    },
    {
      id: 'h3',
      label: 'Heading 3',
      description: 'Small section heading',
      group: 'Text',
      keywords: ['heading', 'h3'],
      iconNode: <TextHThree className={ICON} />,
      apply: (c) => clear(c).toggleHeading({ level: 3 }).run()
    },
    {
      id: 'h4',
      label: 'Heading 4',
      description: 'Smallest section heading',
      group: 'Text',
      keywords: ['heading', 'h4'],
      iconNode: <TextHFour className={ICON} />,
      apply: (c) => clear(c).toggleHeading({ level: 4 }).run()
    },

    // ── Lists ──
    {
      id: 'bullet-list',
      label: 'Bulleted list',
      description: 'A simple bulleted list',
      group: 'Lists',
      keywords: ['bullet', 'unordered', 'ul', 'list'],
      iconNode: <ListBullets className={ICON} />,
      apply: (c) => clear(c).toggleBulletList().run()
    },
    {
      id: 'numbered-list',
      label: 'Numbered list',
      description: 'A list with ordering',
      group: 'Lists',
      keywords: ['number', 'ordered', 'ol', 'list'],
      iconNode: <ListNumbers className={ICON} />,
      apply: (c) => clear(c).toggleOrderedList().run()
    },
    {
      id: 'task-list',
      label: 'To-do list',
      description: 'Track tasks with checkboxes',
      group: 'Lists',
      keywords: ['todo', 'task', 'checkbox', 'checklist'],
      iconNode: <CheckSquare className={ICON} />,
      apply: (c) => clear(c).toggleTaskList().run()
    },
    {
      id: 'toggle-list',
      label: 'Toggle list',
      description: 'Collapsible section',
      group: 'Lists',
      keywords: ['toggle', 'collapse', 'details', 'accordion', 'expand'],
      iconNode: <CaretRight className={ICON} />,
      apply: (c) => clear(c).setDetails().run()
    },

    // ── Blocks ──
    {
      id: 'quote',
      label: 'Quote',
      description: 'Capture a quotation',
      group: 'Blocks',
      keywords: ['quote', 'blockquote', 'citation'],
      iconNode: <Quotes className={ICON} />,
      apply: (c) => clear(c).toggleBlockquote().run()
    },
    {
      id: 'callout',
      label: 'Callout',
      description: 'Highlighted note with an icon',
      group: 'Blocks',
      keywords: ['callout', 'note', 'info', 'tip', 'warning', 'box'],
      iconNode: <Lightbulb className={ICON} />,
      apply: (c) => clear(c).insertContent({ type: 'callout' }).run()
    },
    {
      id: 'code-block',
      label: 'Code block',
      description: 'Syntax-highlighted code',
      group: 'Blocks',
      keywords: ['code', 'snippet', 'fence', 'pre'],
      iconNode: <CodeBlock className={ICON} />,
      apply: (c) => clear(c).toggleCodeBlock().run()
    },
    {
      id: 'table',
      label: 'Table',
      description: 'Insert a 3×3 table with a header row',
      group: 'Blocks',
      keywords: ['table', 'grid', 'rows', 'columns'],
      iconNode: <Table className={ICON} />,
      apply: (c) => clear(c).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
    {
      id: 'divider',
      label: 'Divider',
      description: 'Visually separate sections',
      group: 'Blocks',
      keywords: ['divider', 'hr', 'rule', 'separator', 'line'],
      iconNode: <Minus className={ICON} />,
      apply: (c) => clear(c).setHorizontalRule().run()
    },

    // ── Layout ──
    {
      id: 'columns-2',
      label: '2 columns',
      description: 'Side-by-side layout',
      group: 'Layout',
      keywords: ['column', 'columns', 'grid', 'split', 'two', '2', 'layout'],
      iconNode: <Columns className={ICON} />,
      apply: (c) => clear(c).setColumns(2).run()
    },
    {
      id: 'columns-3',
      label: '3 columns',
      description: 'Three-column layout',
      group: 'Layout',
      keywords: ['column', 'columns', 'grid', 'split', 'three', '3', 'layout'],
      iconNode: <Columns className={ICON} />,
      apply: (c) => clear(c).setColumns(3).run()
    },
    {
      id: 'whiteboard',
      label: 'Whiteboard',
      description: 'Draw diagrams and sketches',
      group: 'Layout',
      keywords: ['whiteboard', 'draw', 'diagram', 'sketch', 'excalidraw', 'canvas'],
      iconNode: <PencilLine className={ICON} />,
      apply: (c) => clear(c).insertContent({ type: 'whiteboard' }).run()
    },

    // ── Media ──
    // Each of these inserts an EMPTY block that renders its own picker (upload / paste a
    // link / GIF). No modal, and an unfinished block looks unfinished.
    {
      id: 'image',
      label: 'Image',
      description: 'Upload or embed by URL',
      group: 'Media',
      keywords: ['image', 'img', 'picture', 'photo', 'upload'],
      iconNode: <ImageIcon className={ICON} />,
      apply: (c) => clear(c).insertContent({ type: 'image' }).run()
    },
    {
      id: 'gif',
      label: 'GIF & sticker',
      description: 'Search GIFs and stickers',
      group: 'Media',
      keywords: ['gif', 'sticker', 'klipy', 'meme', 'animation'],
      iconNode: <GifIcon className={ICON} />,
      apply: (c) =>
        clear(c)
          .insertContent({ type: 'image', attrs: { pick: 'gif' } })
          .run()
    },
    {
      id: 'video',
      label: 'Video',
      description: 'Upload or link a video file',
      group: 'Media',
      keywords: ['video', 'mp4', 'movie', 'clip', 'upload'],
      iconNode: <FilmSlate className={ICON} />,
      apply: (c) => clear(c).insertContent(emptyAttachment('video')).run()
    },
    {
      id: 'audio',
      label: 'Audio',
      description: 'Upload or link an audio file',
      group: 'Media',
      keywords: ['audio', 'sound', 'mp3', 'music', 'podcast'],
      iconNode: <MusicNotes className={ICON} />,
      apply: (c) => clear(c).insertContent(emptyAttachment('audio')).run()
    },
    {
      id: 'file',
      label: 'File',
      description: 'Attach a downloadable file',
      group: 'Media',
      keywords: ['file', 'attachment', 'pdf', 'doc', 'download'],
      iconNode: <Paperclip className={ICON} />,
      apply: (c) => clear(c).insertContent(emptyAttachment('file')).run()
    },
    {
      id: 'embed',
      label: 'Video embed',
      description: 'Embed a YouTube or Vimeo video',
      group: 'Media',
      keywords: ['video', 'embed', 'youtube', 'vimeo', 'iframe'],
      iconNode: <VideoCamera className={ICON} />,
      apply: (c) =>
        clear(c)
          .insertContent({ type: 'embed', attrs: { url: '' } })
          .run()
    },
    {
      id: 'bookmark',
      label: 'Bookmark',
      description: 'Link out to a page',
      group: 'Media',
      keywords: ['bookmark', 'link', 'url', 'web'],
      iconNode: <Browser className={ICON} />,
      // The host owns the dialog: `window.prompt` is unavailable in Electron (it refuses
      // to show one), so a command can't ask for the URL itself.
      apply: (c) => {
        clear(c).run()
        c.openBookmark?.()
      }
    },

    // ── Insert ──
    {
      id: 'emoji',
      label: 'Emoji',
      description: 'Pick an emoji',
      group: 'Insert',
      keywords: ['emoji', 'emoticon', 'smiley', 'reaction', 'icon'],
      iconNode: <Smiley className={ICON} />,
      apply: (c) => {
        clear(c).run()
        // Anchor the picker where the `/emoji` text just was — the command has the editor
        // right here, so nothing has to reach for it later.
        const { from } = c.editor.state.selection
        const caret = c.editor.view.coordsAtPos(from)
        c.openEmoji(new DOMRect(caret.left, caret.top, 0, caret.bottom - caret.top))
      }
    }
  ]
}
