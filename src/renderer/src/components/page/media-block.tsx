import { useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import {
  DownloadSimple,
  FileArrowDown,
  ImageSquare,
  MusicNotes,
  UploadSimple,
  VideoCamera
} from '@phosphor-icons/react'
import { MediaPlayer } from '@renderer/components/common/media-player'

/**
 * ONE set of media blocks with a **shared upload/embed placeholder**, replacing BlockNote's
 * native image / audio / video / file blocks so they all look identical (the native ones
 * mixed a raw `<audio>`/`<video>` player with a separate tabbed "Add file" panel).
 *
 * Each block stores a `url` (uploaded to R2 online / a data URL offline, or a pasted direct
 * URL) + a `name`. The rendered form differs by kind — the shared **Vidstack** `MediaPlayer`
 * for audio/video, an `<img>` for image, a download card for file — but the **empty state is
 * the same component** everywhere. YouTube/Vimeo are a separate `embed` block (those need an
 * iframe, not a media element).
 *
 * The player (`common/media-player.tsx`) is shared with chat attachments; Vidstack loads only
 * in that (lazy) chunk, never the main bundle. Trade-off vs. the native blocks: no image
 * resize/caption handles and no drag-drop-to-create (slash menu + the Upload button cover it).
 */

type MediaKind = 'audio' | 'video' | 'image' | 'file'

const KIND_META: Record<MediaKind, { icon: typeof ImageSquare; label: string; accept: string }> = {
  image: { icon: ImageSquare, label: 'an image', accept: 'image/*' },
  video: { icon: VideoCamera, label: 'a video', accept: 'video/*' },
  audio: { icon: MusicNotes, label: 'audio', accept: 'audio/*' },
  file: { icon: FileArrowDown, label: 'a file', accept: '' }
}

const mediaPropSchema = {
  url: { default: '' as const },
  name: { default: '' as const },
  caption: { default: '' as const }
}

/** A file (download) card — the rendered form of the `file` block. */
function FileCard({ url, name }: { url: string; name: string }): React.JSX.Element {
  return (
    <a
      className="zinx-file-card"
      href={url}
      target="_blank"
      rel="noreferrer"
      download
      contentEditable={false}
      suppressContentEditableWarning
      onPointerDown={(event) => event.stopPropagation()}
    >
      <FileArrowDown className="zinx-file-icon" weight="duotone" />
      <span className="zinx-file-name">{name || 'Download file'}</span>
      <DownloadSimple className="zinx-file-download" />
    </a>
  )
}

/** The shared empty state for every kind: **Upload** (via the editor's `uploadFile`) or paste
 *  a direct URL. `onSelect` carries an optional name (the uploaded file's, for the file card). */
function MediaPlaceholder({
  kind,
  onSelect,
  upload
}: {
  kind: MediaKind
  onSelect: (url: string, name?: string) => void
  upload: (file: File) => Promise<string>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const meta = KIND_META[kind]
  const Icon = meta.icon

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    try {
      const url = await upload(file)
      if (url) onSelect(url, file.name)
    } catch {
      // the upload handler surfaces its own error; just clear the spinner
    } finally {
      setBusy(false)
    }
  }

  return (
    // `content:'none'` void block — `stopPropagation` keeps clicks/keys in the field rather
    // than selecting the block.
    <div
      className="zinx-media-empty"
      contentEditable={false}
      suppressContentEditableWarning
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="zinx-media-hint">
        <Icon weight="duotone" /> Add {meta.label}
      </span>
      <div className="zinx-media-actions">
        <label className="zinx-media-upload">
          <input
            type="file"
            accept={meta.accept || undefined}
            hidden
            disabled={busy}
            onChange={(event) => void pick(event.target.files?.[0])}
          />
          <UploadSimple />
          {busy ? 'Uploading…' : 'Upload'}
        </label>
        <form
          className="zinx-media-row"
          onSubmit={(event) => {
            event.preventDefault()
            const value = draft.trim()
            if (value) onSelect(value)
          }}
        >
          <input
            className="zinx-media-input"
            value={draft}
            placeholder="or paste a URL…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <button type="submit" className="zinx-media-button">
            Embed
          </button>
        </form>
      </div>
    </div>
  )
}

/** The rendered content for a kind, given its stored url/name + the two callbacks. Takes only
 *  primitives (no BlockNote types), so the block specs below can delegate to it while their
 *  render arrow keeps BlockNote's precise `block`/`editor` types. */
function MediaContent({
  kind,
  url,
  name,
  onSelect,
  upload
}: {
  kind: MediaKind
  url: string
  name: string
  onSelect: (url: string, name?: string) => void
  upload: (file: File) => Promise<string>
}): React.JSX.Element {
  if (!url) return <MediaPlaceholder kind={kind} onSelect={onSelect} upload={upload} />
  if (kind === 'image') {
    return (
      <img
        className="zinx-media-image"
        src={url}
        alt={name}
        contentEditable={false}
        suppressContentEditableWarning
      />
    )
  }
  if (kind === 'file') return <FileCard url={url} name={name} />
  return (
    <div className="zinx-media" contentEditable={false} suppressContentEditableWarning>
      <MediaPlayer kind={kind} src={url} title={name} />
    </div>
  )
}

// One spec per kind (not a factory — that would trip the explicit-return-type lint). Each
// render arrow keeps BlockNote's real `block`/`editor` types and forwards primitives to
// `MediaContent`, so there's no meaningful duplication and no loosely-typed shared helper.
const uploadVia =
  (editor: {
    uploadFile?: (file: File) => Promise<string | Record<string, unknown>>
  }): ((file: File) => Promise<string>) =>
  async (file: File): Promise<string> => {
    const result = await editor.uploadFile?.(file)
    return typeof result === 'string' ? result : ''
  }

export const ImageBlock = createReactBlockSpec(
  { type: 'image', propSchema: mediaPropSchema, content: 'none' },
  {
    render: ({ block, editor }): React.JSX.Element => (
      <MediaContent
        kind="image"
        url={String(block.props.url ?? '')}
        name={String(block.props.name ?? '')}
        onSelect={(url, name) =>
          editor.updateBlock(block, { type: 'image', props: { url, name: name ?? '' } })
        }
        upload={uploadVia(editor)}
      />
    )
  }
)

export const VideoBlock = createReactBlockSpec(
  { type: 'video', propSchema: mediaPropSchema, content: 'none' },
  {
    render: ({ block, editor }): React.JSX.Element => (
      <MediaContent
        kind="video"
        url={String(block.props.url ?? '')}
        name={String(block.props.name ?? '')}
        onSelect={(url, name) =>
          editor.updateBlock(block, { type: 'video', props: { url, name: name ?? '' } })
        }
        upload={uploadVia(editor)}
      />
    )
  }
)

export const AudioBlock = createReactBlockSpec(
  { type: 'audio', propSchema: mediaPropSchema, content: 'none' },
  {
    render: ({ block, editor }): React.JSX.Element => (
      <MediaContent
        kind="audio"
        url={String(block.props.url ?? '')}
        name={String(block.props.name ?? '')}
        onSelect={(url, name) =>
          editor.updateBlock(block, { type: 'audio', props: { url, name: name ?? '' } })
        }
        upload={uploadVia(editor)}
      />
    )
  }
)

export const FileBlock = createReactBlockSpec(
  { type: 'file', propSchema: mediaPropSchema, content: 'none' },
  {
    render: ({ block, editor }): React.JSX.Element => (
      <MediaContent
        kind="file"
        url={String(block.props.url ?? '')}
        name={String(block.props.name ?? '')}
        onSelect={(url, name) =>
          editor.updateBlock(block, { type: 'file', props: { url, name: name ?? '' } })
        }
        upload={uploadVia(editor)}
      />
    )
  }
)
