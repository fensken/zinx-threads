import { useRef, useState, type ReactNode } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import {
  FileArrowDown,
  GifIcon,
  Image as ImageIcon,
  LinkSimple,
  MusicNotes,
  Paperclip,
  UploadSimple,
  VideoCamera
} from '@phosphor-icons/react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Spinner } from '@renderer/components/ui/spinner'
import { GifPicker } from '@renderer/components/pickers/gif-picker'
import { MediaPlayer } from '@renderer/components/common/media-player'
import { MAX_UPLOAD_LABEL, withinUploadLimit } from '@renderer/lib/upload-limits'
import { cn } from '@renderer/lib/utils'

/**
 * Media blocks for the doc editor: image, video, audio and file.
 *
 * These follow BlockNote's model rather than TipTap's stock `Image`: a block is inserted
 * EMPTY and renders its own picker inline (upload / paste a link / GIF), so `/image` never
 * needs a modal and an unfinished block *looks* unfinished. Once a source is set the panel
 * is replaced by the media itself.
 *
 * The uploader is an extension **option**, so a node view deep inside the document can
 * reach it without prop-drilling through ProseMirror.
 */

export interface MediaUploadOptions {
  /** Uploads a file and resolves to its durable URL. Absent → the Upload tab is inert. */
  upload?: (file: File) => Promise<string>
}

// ── Shared empty-state picker ────────────────────────────────────────────────

type PickerTab = 'upload' | 'link' | 'gif'

const TAB_LABEL: Record<PickerTab, string> = {
  upload: 'Upload',
  link: 'Embed link',
  gif: 'GIF'
}

function MediaPicker({
  label,
  icon,
  accept,
  tabs,
  defaultTab,
  upload,
  onPick
}: {
  label: string
  icon: ReactNode
  accept: string
  tabs: PickerTab[]
  /** Which tab opens first — `/gif` lands straight on the GIF search. */
  defaultTab?: PickerTab
  upload?: (file: File) => Promise<string>
  onPick: (url: string, file?: File) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<PickerTab>(
    defaultTab && tabs.includes(defaultTab) ? defaultTab : tabs[0]
  )
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file || !upload) return
    if (!withinUploadLimit(file.size)) {
      setError(`That file is too large (max ${MAX_UPLOAD_LABEL}).`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      onPick(await upload(file), file)
    } catch {
      setError('Upload failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="zinx-media-picker" contentEditable={false}>
      <div className="zinx-media-picker-head">
        {icon}
        <span>{label}</span>
      </div>

      <div className="zinx-media-tabs">
        {tabs.map((value) => (
          <Button
            key={value}
            type="button"
            variant={tab === value ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setTab(value)}
          >
            {TAB_LABEL[value]}
          </Button>
        ))}
      </div>

      {tab === 'upload' ? (
        <div className="zinx-media-body">
          <input
            ref={fileInput}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0])
              // Reset so picking the same file twice still fires a change.
              event.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!upload || busy}
            onClick={() => fileInput.current?.click()}
            className="gap-1.5"
          >
            {busy ? <Spinner className="size-4" /> : <UploadSimple className="size-4" />}
            {busy ? 'Uploading…' : 'Choose a file'}
          </Button>
        </div>
      ) : null}

      {tab === 'link' ? (
        <form
          className="zinx-media-body"
          onSubmit={(event) => {
            event.preventDefault()
            const url = draft.trim()
            if (url) onPick(url)
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            // ProseMirror would otherwise swallow the keystrokes.
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="https://…"
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" disabled={!draft.trim()}>
            <LinkSimple className="size-4" />
            Embed
          </Button>
        </form>
      ) : null}

      {tab === 'gif' ? (
        <div className="zinx-media-body">
          <Popover>
            <PopoverTrigger
              render={<Button type="button" variant="outline" size="sm" className="gap-1.5" />}
            >
              <GifIcon className="size-4" />
              Search GIFs &amp; stickers
            </PopoverTrigger>
            <PopoverContent className="w-[22rem] p-0" align="start">
              <GifPicker onGifSelect={(url) => onPick(url)} />
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      {error ? <p className="zinx-media-error">{error}</p> : null}
    </div>
  )
}

// ── Resizing ─────────────────────────────────────────────────────────────────

const MIN_MEDIA_WIDTH = 100

/**
 * Wraps a piece of media in drag-to-resize handles (Notion / BlockNote style).
 *
 * The drag writes straight to `element.style.width` and commits only on pointer-up. Going
 * through React state per `pointermove` would mean a re-render *and* — because width is a
 * node attribute — a document transaction plus a debounced save, on every pixel.
 *
 * Width is stored in px rather than a percentage so a resized image keeps the size it was
 * given regardless of the reader's window; it's clamped to the column on the way in, and
 * `max-width: 100%` handles narrower screens.
 */
export function Resizable({
  width,
  editable,
  fill = false,
  onCommit,
  children
}: {
  width: number | null
  editable: boolean
  /** Start at the full column width instead of the content's natural size. Right for video
   *  and embeds (meant to be watched); wrong for images and GIFs, which would just be
   *  upscaled and blurry. */
  fill?: boolean
  onCommit: (width: number | null) => void
  children: ReactNode
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null)
  const frameClass = cn('zinx-media-frame', fill && 'zinx-media-frame-fill')

  if (!editable) {
    return (
      <div className={frameClass} style={width ? { width } : undefined}>
        {children}
      </div>
    )
  }

  const startDrag = (event: React.PointerEvent, side: 'left' | 'right'): void => {
    // Stop ProseMirror treating this as a selection drag on the node.
    event.preventDefault()
    event.stopPropagation()

    const frame = frameRef.current
    const handle = event.currentTarget as HTMLElement
    if (!frame) return

    const startX = event.clientX
    const startWidth = frame.getBoundingClientRect().width
    const maxWidth = frame.parentElement?.getBoundingClientRect().width ?? startWidth

    // POINTER CAPTURE is what makes this work over a video. A player is an <iframe> for
    // provider sources, and the moment the cursor crosses into a cross-origin iframe the
    // parent document stops receiving pointer events at all — a window-level `pointermove`
    // listener simply goes quiet and the drag freezes. (Images never hit this, which is
    // why they resized fine.) Capturing redirects every later pointer event to this
    // element regardless of what is underneath.
    handle.setPointerCapture(event.pointerId)

    // Belt and braces: while dragging, stop the player reacting to the pointer at all, so
    // a stray hover can't pop its controls up mid-drag.
    frame.dataset.resizing = 'true'

    const move = (moveEvent: PointerEvent): void => {
      // Dragging the LEFT handle outward means growing, hence the flip.
      const delta = side === 'right' ? moveEvent.clientX - startX : startX - moveEvent.clientX
      const next = Math.round(Math.min(Math.max(startWidth + delta, MIN_MEDIA_WIDTH), maxWidth))
      frame.style.width = `${next}px`
    }

    const end = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      if (handle.hasPointerCapture?.(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId)
      }
      delete frame.dataset.resizing
      const final = Math.round(frame.getBoundingClientRect().width)
      // Snapped back to full width — drop the attribute entirely rather than freezing
      // today's column width into the document.
      onCommit(final >= maxWidth - 2 ? null : final)
    }

    // Listen on the capturing element, not the window: with capture active the events are
    // retargeted here.
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  return (
    <div
      ref={frameRef}
      className={cn(frameClass, 'zinx-media-resizable')}
      style={width ? { width } : undefined}
    >
      {children}
      {(['left', 'right'] as const).map((side) => (
        <button
          key={side}
          type="button"
          aria-label={`Resize from the ${side}`}
          className={cn('zinx-media-grip', `zinx-media-grip-${side}`)}
          onPointerDown={(event) => startDrag(event, side)}
          // Double-click snaps back to the full column.
          onDoubleClick={() => onCommit(null)}
        />
      ))}
    </div>
  )
}

// ── Image ────────────────────────────────────────────────────────────────────

/**
 * Stock `Image`, extended with an inline picker and a caption.
 *
 * `src` is allowed to be empty so a freshly-inserted block renders its own picker instead
 * of a broken `<img>`.
 */
export const ImageBlock = Image.extend<MediaUploadOptions>({
  addOptions() {
    return { ...this.parent?.(), inline: false, allowBase64: false }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      src: { default: '' },
      caption: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-caption') ?? '',
        renderHTML: (attributes) =>
          attributes.caption ? { 'data-caption': attributes.caption as string } : {}
      },
      // Which picker tab to open on. Transient — cleared the moment a source is chosen,
      // so it never lingers in saved content.
      pick: { default: null, rendered: false },
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

  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  }
})

function ImageView({
  node,
  updateAttributes,
  editor,
  extension,
  deleteNode
}: NodeViewProps): React.JSX.Element {
  const src = String(node.attrs.src ?? '')
  const caption = String(node.attrs.caption ?? '')
  const upload = (extension.options as MediaUploadOptions).upload

  if (!src) {
    if (!editor.isEditable) return <NodeViewWrapper />
    return (
      <NodeViewWrapper className="zinx-media">
        <MediaPicker
          label="Add an image"
          icon={<ImageIcon className="size-4" weight="duotone" />}
          accept="image/*"
          tabs={['upload', 'link', 'gif']}
          defaultTab={(node.attrs.pick as PickerTab | null) ?? undefined}
          upload={upload}
          onPick={(url, file) => updateAttributes({ src: url, alt: file?.name ?? '', pick: null })}
        />
        <RemoveBlock editor={editor} onRemove={deleteNode} />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="zinx-media">
      <Resizable
        width={node.attrs.width as number | null}
        editable={editor.isEditable}
        onCommit={(width) => updateAttributes({ width })}
      >
        <img src={src} alt={String(node.attrs.alt ?? '')} className="zinx-media-image" />
      </Resizable>
      <Caption
        value={caption}
        editable={editor.isEditable}
        onChange={(value) => updateAttributes({ caption: value })}
      />
    </NodeViewWrapper>
  )
}

// ── Video / audio / file ─────────────────────────────────────────────────────

export type AttachmentKind = 'video' | 'audio' | 'file'

const ATTACHMENT_META: Record<AttachmentKind, { label: string; accept: string; icon: ReactNode }> =
  {
    video: {
      label: 'Add a video',
      accept: 'video/*',
      icon: <VideoCamera className="size-4" weight="duotone" />
    },
    audio: {
      label: 'Add audio',
      accept: 'audio/*',
      icon: <MusicNotes className="size-4" weight="duotone" />
    },
    file: {
      label: 'Add a file',
      accept: '*/*',
      icon: <Paperclip className="size-4" weight="duotone" />
    }
  }

/**
 * ONE node for video, audio and file — they differ only in how the resolved source is
 * presented, so three near-identical nodes would be noise (and three more things to teach
 * every consumer about).
 */
export const AttachmentNode = Node.create<MediaUploadOptions>({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return { upload: undefined }
  },

  addAttributes() {
    return {
      kind: {
        default: 'file',
        parseHTML: (element) => element.getAttribute('data-kind') ?? 'file',
        renderHTML: (attributes) => ({ 'data-kind': attributes.kind })
      },
      src: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-src') ?? '',
        renderHTML: (attributes) => ({ 'data-src': attributes.src })
      },
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-name') ?? '',
        renderHTML: (attributes) => ({ 'data-name': attributes.name })
      },
      caption: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-caption') ?? '',
        renderHTML: (attributes) => ({ 'data-caption': attributes.caption })
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
    return [{ tag: 'div[data-attachment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-attachment': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView)
  }
})

function AttachmentView({
  node,
  updateAttributes,
  editor,
  extension,
  deleteNode
}: NodeViewProps): React.JSX.Element {
  const kind = (node.attrs.kind as AttachmentKind) ?? 'file'
  const src = String(node.attrs.src ?? '')
  const name = String(node.attrs.name ?? '')
  const caption = String(node.attrs.caption ?? '')
  const upload = (extension.options as MediaUploadOptions).upload
  const meta = ATTACHMENT_META[kind] ?? ATTACHMENT_META.file

  if (!src) {
    if (!editor.isEditable) return <NodeViewWrapper />
    return (
      <NodeViewWrapper className="zinx-media">
        <MediaPicker
          label={meta.label}
          icon={meta.icon}
          accept={meta.accept}
          tabs={['upload', 'link']}
          upload={upload}
          onPick={(url, file) => updateAttributes({ src: url, name: file?.name ?? '' })}
        />
        <RemoveBlock editor={editor} onRemove={deleteNode} />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="zinx-media">
      {kind === 'video' ? (
        <Resizable
          width={node.attrs.width as number | null}
          editable={editor.isEditable}
          fill
          onCommit={(width) => updateAttributes({ width })}
        >
          <MediaPlayer src={src} title={name || undefined} kind="video" />
        </Resizable>
      ) : null}
      {kind === 'audio' ? <MediaPlayer src={src} title={name || undefined} kind="audio" /> : null}
      {kind === 'file' ? (
        <a
          href={src}
          target="_blank"
          rel="noreferrer noopener"
          download={name || undefined}
          className="zinx-media-file"
        >
          <FileArrowDown className="size-5 shrink-0" weight="duotone" />
          <span className="truncate">{name || src}</span>
        </a>
      ) : null}
      <Caption
        value={caption}
        editable={editor.isEditable}
        onChange={(value) => updateAttributes({ caption: value })}
      />
    </NodeViewWrapper>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Caption({
  value,
  editable,
  onChange
}: {
  value: string
  editable: boolean
  onChange: (value: string) => void
}): React.JSX.Element | null {
  if (!editable) {
    return value ? <figcaption className="zinx-media-caption">{value}</figcaption> : null
  }
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => event.stopPropagation()}
      placeholder="Write a caption…"
      aria-label="Caption"
      className="zinx-media-caption-input"
    />
  )
}

function RemoveBlock({
  editor,
  onRemove
}: {
  editor: NodeViewProps['editor']
  onRemove: () => void
}): React.JSX.Element | null {
  if (!editor.isEditable) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onRemove}
      className="h-6 self-start px-1.5 text-xs text-muted-foreground hover:text-destructive"
    >
      Remove
    </Button>
  )
}
