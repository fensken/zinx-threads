import type { JSONContent } from '@tiptap/react'
import { MENTION_PREFIX, mentionHref, type MentionKind } from '@renderer/lib/mention'
import rehypeStringify from 'rehype-stringify'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

// Serialize the chat composer's TipTap document to Markdown. Deliberately scoped
// to the exact node/mark set the composer enables (paragraph, hardBreak, bullet/
// ordered list, blockquote, codeBlock + bold/italic/strike/code/link) — a small,
// auditable serializer beats a general-purpose one we can't reason about.
//
// Storage stays a Markdown string in `messages.body` (mirrors `_zinx`), so the
// message renderer is just react-markdown.

/** Escape the inline characters that would otherwise be read as Markdown. The
 *  composer is WYSIWYG, so literal text must round-trip literally. */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_~[\]])/g, '\\$1')
}

/** Escape a leading character that would turn a paragraph line into a heading,
 *  list item, or quote. */
function escapeLeading(line: string): string {
  return line.replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3')
}

function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return ''
  return nodes.map(serializeInlineNode).join('')
}

function serializeInlineNode(node: JSONContent): string {
  if (node.type === 'hardBreak') return '\n'

  // A mention is a link with our private scheme — see `lib/mention.ts`.
  if (node.type === 'mention') {
    const kind = node.attrs?.kind as MentionKind | undefined
    const id = typeof node.attrs?.mentionId === 'string' ? node.attrs.mentionId : ''
    const label = typeof node.attrs?.label === 'string' ? node.attrs.label : ''
    if (!kind || !id) return ''
    return `[${MENTION_PREFIX[kind]}${escapeInline(label)}](${mentionHref(kind, id)})`
  }

  // Inline images (GIFs) — so an edited GIF message round-trips instead of
  // being silently dropped.
  if (node.type === 'image') {
    const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : 'gif'
    return src ? `![${alt}](${src})` : ''
  }

  if (node.type !== 'text' || !node.text) return ''

  const marks = node.marks ?? []
  const has = (name: string): boolean => marks.some((mark) => mark.type === name)

  let out: string
  if (has('code')) {
    // Inline code is literal — never escape inside it.
    out = `\`${node.text}\``
  } else {
    out = escapeInline(node.text)
    if (has('bold')) out = `**${out}**`
    if (has('italic')) out = `_${out}_`
    if (has('strike')) out = `~~${out}~~`
  }

  const href = marks.find((mark) => mark.type === 'link')?.attrs?.href
  if (typeof href === 'string' && href) out = `[${out}](${href})`
  return out
}

/** Each entry is one Markdown *block* (it may contain newlines internally). */
function serializeBlocks(nodes: JSONContent[] | undefined): string[] {
  if (!nodes) return []
  const blocks: string[] = []

  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph': {
        const text = serializeInline(node.content)
        blocks.push(text.split('\n').map(escapeLeading).join('\n'))
        break
      }
      case 'blockquote': {
        const inner = serializeBlocks(node.content).join('\n\n')
        blocks.push(
          inner
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n')
        )
        break
      }
      case 'codeBlock': {
        const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
        const code = (node.content ?? []).map((child) => child.text ?? '').join('')
        blocks.push(`\`\`\`${language}\n${code}\n\`\`\``)
        break
      }
      case 'bulletList':
      case 'orderedList': {
        const ordered = node.type === 'orderedList'
        const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
        const lines: string[] = []
        ;(node.content ?? []).forEach((item, index) => {
          const marker = ordered ? `${start + index}. ` : '- '
          const pad = ' '.repeat(marker.length)
          const body = serializeBlocks(item.content).join('\n\n').split('\n')
          lines.push(marker + (body[0] ?? ''))
          for (const rest of body.slice(1)) lines.push(rest ? pad + rest : '')
        })
        // A list is ONE block — otherwise the `\n\n` join below double-spaces it.
        blocks.push(lines.join('\n'))
        break
      }
      default: {
        if (node.content) blocks.push(...serializeBlocks(node.content))
      }
    }
  }
  return blocks
}

/** TipTap doc JSON → Markdown. Returns '' for an empty document. */
export function docToMarkdown(doc: JSONContent): string {
  return serializeBlocks(doc.content)
    .filter((block) => block.trim().length > 0)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// The inverse direction, for edit-in-place: TipTap parses HTML into its schema,
// so go Markdown → HTML with the *same* remark plugins the message renderer uses
// (`markdown-message.tsx`). That keeps "what you see" and "what you edit" in sync.
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkRehype)
  .use(rehypeStringify)

/** Markdown → HTML, suitable for `editor.commands.setContent(html)`. */
export function markdownToHtml(markdown: string): string {
  return String(markdownProcessor.processSync(markdown))
}
