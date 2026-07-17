import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  type BlockNoteEditor
} from '@blocknote/core'
import { codeBlockOptions } from '@blocknote/code-block'
import { createReactBlockSpec } from '@blocknote/react'
import { VideoCamera } from '@phosphor-icons/react'
import {
  AudioBlock,
  FileBlock,
  ImageBlock,
  VideoBlock
} from '@renderer/components/page/media-block'
import { MentionInline } from '@renderer/components/page/page-mentions'

// The editor's schema + the conversions in and out of it. Split out of
// `page-editor.tsx` so that file exports components only (react-refresh).

/** A YouTube / Vimeo watch URL → its privacy-friendly **embed** URL, or `null` if it
 *  isn't one we can iframe. The native `video` block plays a direct file (`<video src>`);
 *  YouTube/Vimeo links need an iframe, which is what the `embed` block below renders. */
export function toEmbedUrl(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const host = parsed.hostname.replace(/^(www\.|m\.)/, '')
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id =
      parsed.searchParams.get('v') ??
      parsed.pathname.match(/\/(?:embed|shorts|v)\/([\w-]+)/)?.[1] ??
      null
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
  }
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0]
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
  }
  if (host === 'vimeo.com') {
    const id = parsed.pathname
      .split('/')
      .filter(Boolean)
      .find((seg) => /^\d+$/.test(seg))
    return id ? `https://player.vimeo.com/video/${id}` : null
  }
  if (host === 'player.vimeo.com') return parsed.toString()
  return null
}

/** A video EMBED block (Notion-style) — YouTube / Vimeo by URL, rendered as a responsive
 *  16:9 iframe. Empty → a paste-a-link placeholder (an uncontrolled input, read on submit,
 *  so this needs no hooks and can live inline like `callout`). The whole block is
 *  `content: 'none'` and non-editable, so it sits outside ProseMirror's editable content —
 *  `stopPropagation` on the field keeps clicks/keys in the input rather than selecting the
 *  block. The URL is stored in the page's BlockNote JSON like any other block. */
const EmbedBlock = createReactBlockSpec(
  {
    type: 'embed',
    propSchema: { url: { default: '' } },
    content: 'none'
  },
  {
    render: ({ block, editor }): React.JSX.Element => {
      const url = String(block.props.url ?? '')
      if (!url) {
        return (
          <form
            className="zinx-embed zinx-embed-empty"
            contentEditable={false}
            suppressContentEditableWarning
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              const value = event.currentTarget.querySelector('input')?.value.trim()
              if (value) editor.updateBlock(block, { type: 'embed', props: { url: value } })
            }}
          >
            <span className="zinx-embed-hint">
              <VideoCamera weight="duotone" /> Embed a YouTube or Vimeo video
            </span>
            <span className="zinx-embed-row">
              <input
                className="zinx-embed-input"
                placeholder="Paste a YouTube or Vimeo link…"
                onKeyDown={(event) => event.stopPropagation()}
              />
              <button type="submit" className="zinx-embed-button">
                Embed
              </button>
            </span>
          </form>
        )
      }
      const src = toEmbedUrl(url)
      if (!src) {
        return (
          <div
            className="zinx-embed zinx-embed-fallback"
            contentEditable={false}
            suppressContentEditableWarning
          >
            Couldn’t embed that link —{' '}
            <a href={url} target="_blank" rel="noreferrer">
              open it
            </a>
            . Only YouTube and Vimeo are supported.
          </div>
        )
      }
      return (
        <div className="zinx-embed" contentEditable={false} suppressContentEditableWarning>
          <div className="zinx-embed-frame">
            <iframe
              src={src}
              title="Embedded video"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>
      )
    }
  }
)

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
    // Replace BlockNote's native image / audio / video / file blocks with our own, so they
    // share ONE upload/embed placeholder (audio/video play through Vidstack); the `embed`
    // block handles YouTube/Vimeo links separately.
    image: ImageBlock(),
    audio: AudioBlock(),
    video: VideoBlock(),
    file: FileBlock(),
    callout: CalloutBlock(),
    embed: EmbedBlock()
  },
  // `@user` / `#channel` mentions — see `page-mentions.tsx`; the `@`/`#` menus live in
  // `page-editor.tsx`, fed by the WorkspaceDirectory.
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: MentionInline
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
