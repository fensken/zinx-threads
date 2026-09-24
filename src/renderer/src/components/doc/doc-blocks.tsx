import { useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps
} from '@tiptap/react'
import { VideoCamera } from '@phosphor-icons/react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Resizable } from '@renderer/components/doc/doc-media'
import { toProviderSrc } from '@renderer/components/doc/doc-embed-src'
import { MediaPlayer } from '@renderer/components/common/media-player'
import { platform } from '@renderer/lib/platform'

/**
 * Two custom doc blocks.
 *
 * `callout` — a highlighted note with a leading emoji, holding inline content.
 * `embed`   — a YouTube/Vimeo player.
 *
 * Both are plain TipTap nodes, so they live in the same document as everything else and
 * serialize into its JSON with no special handling.
 */

// ── Callout ──────────────────────────────────────────────────────────────────

const CALLOUT_EMOJI = ['💡', '⚠️', '✅', '❌', '📌', '🔥', 'ℹ️']

export const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  defining: true,
  // Without this the drag handle refuses to attach to a callout — the plugin only offers a
  // grip for nodes the schema says are draggable.
  draggable: true,

  addAttributes() {
    return {
      emoji: {
        default: '💡',
        parseHTML: (element) => element.getAttribute('data-emoji') ?? '💡',
        renderHTML: (attributes) => ({ 'data-emoji': attributes.emoji })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'zinx-callout' }),
      0
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  }
})

function CalloutView({ node, updateAttributes, editor }: NodeViewProps): React.JSX.Element {
  const emoji = String(node.attrs.emoji ?? '💡')
  // A tiny inline cycler rather than the full emoji picker: the icon is decoration, and a
  // popover here would fight the editor for focus on every click.
  const cycle = (): void => {
    const next = CALLOUT_EMOJI[(CALLOUT_EMOJI.indexOf(emoji) + 1) % CALLOUT_EMOJI.length]
    updateAttributes({ emoji: next })
  }

  return (
    <NodeViewWrapper className="zinx-callout" data-callout="">
      <button
        type="button"
        contentEditable={false}
        onClick={cycle}
        disabled={!editor.isEditable}
        title="Change icon"
        className="zinx-callout-emoji"
      >
        {emoji}
      </button>
      {/* Where ProseMirror renders the editable content. */}
      <NodeViewContent className="zinx-callout-body" />
    </NodeViewWrapper>
  )
}

// ── Embed (YouTube / Vimeo) ──────────────────────────────────────────────────

export const EmbedNode = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-url') ?? '',
        renderHTML: (attributes) => ({ 'data-url': attributes.url })
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-width')
          return raw ? Number(raw) : null
        },
        renderHTML: (attributes) =>
          attributes.width ? { 'data-width': String(attributes.width) } : {}
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-embed]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-embed': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView)
  }
})

function EmbedView({ node, updateAttributes, editor }: NodeViewProps): React.JSX.Element {
  const url = String(node.attrs.url ?? '')
  const [draft, setDraft] = useState('')

  if (!url) {
    if (!editor.isEditable) return <NodeViewWrapper />
    return (
      <NodeViewWrapper className="zinx-embed zinx-embed-empty">
        <span className="zinx-embed-hint">
          <VideoCamera weight="duotone" /> Embed a YouTube or Vimeo video
        </span>
        <form
          className="zinx-embed-row"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim()) updateAttributes({ url: draft.trim() })
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste a YouTube or Vimeo link…"
            className="h-8 text-sm"
            // Keep ProseMirror from stealing the keystrokes.
            onKeyDown={(event) => event.stopPropagation()}
          />
          <Button type="submit" size="sm" disabled={!draft.trim()}>
            Embed
          </Button>
        </form>
      </NodeViewWrapper>
    )
  }

  const src = toProviderSrc(url)
  if (!src) {
    return (
      <NodeViewWrapper className="zinx-embed zinx-embed-fallback">
        Couldn&apos;t embed that link —{' '}
        <button type="button" onClick={() => void platform.openExternal(url)}>
          open it
        </button>
        . Only YouTube and Vimeo are supported.
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="zinx-embed">
      <Resizable
        width={node.attrs.width as number | null}
        editable={editor.isEditable}
        fill
        onCommit={(width) => updateAttributes({ width })}
      >
        {/* Vidstack rather than a raw provider iframe: a YouTube embed then gets the same
            controls, keyboard shortcuts and captions UI as an uploaded file, instead of
            YouTube's own chrome. */}
        <MediaPlayer src={src} title="Embedded video" kind="video" />
      </Resizable>
    </NodeViewWrapper>
  )
}
