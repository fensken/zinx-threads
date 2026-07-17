import { lazy, Suspense, useState } from 'react'
import { ArrowsOut, DownloadSimple, File as FileIcon } from '@phosphor-icons/react'
import { platform } from '@renderer/lib/platform'
import { downloadFile } from '@renderer/lib/download-file'
import { formatBytes } from '@renderer/lib/format-bytes'
import { ImageLightbox } from '@renderer/components/chat/image-lightbox'
import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/utils'

/** Vidstack is heavy (~300 kB) and chat is in the MAIN bundle, so the player is lazy — it
 *  loads only when a message actually carries audio/video, keeping it out of the entry chunk.
 *  Shared with the page editor's media blocks (`common/media-player.tsx`). */
const LazyMediaPlayer = lazy(() => import('@renderer/components/common/media-player'))

export interface RenderedAttachment {
  key: string
  url: string
  name: string
  contentType: string
  size: number
}

/** Files hanging off a message — image thumbnails inline, everything else as a
 *  download chip. `pending` dims them (they're mid-send with a local preview). */
export function MessageAttachments({
  attachments,
  pending
}: {
  attachments: RenderedAttachment[]
  pending?: boolean
}): React.JSX.Element | null {
  // The image open in the lightbox, if any (only for delivered messages).
  const [zoomed, setZoomed] = useState<RenderedAttachment | null>(null)

  if (attachments.length === 0) return null
  return (
    <>
      <div className={cn('mt-1.5 flex flex-wrap gap-2', pending && 'opacity-70')}>
        {attachments.map((attachment) => {
          const type = attachment.contentType
          const key = attachment.key + attachment.url + attachment.name
          if (type.startsWith('image/') && attachment.url) {
            return (
              <ImageThumb
                key={key}
                attachment={attachment}
                pending={pending}
                onOpen={() => setZoomed(attachment)}
              />
            )
          }
          // Delivered audio/video → an inline (lazy) player. While pending (local, uploading)
          // there's no server URL yet, so it falls through to the dimmed file chip.
          if (
            (type.startsWith('video/') || type.startsWith('audio/')) &&
            attachment.url &&
            !pending
          ) {
            const kind = type.startsWith('video/') ? 'video' : 'audio'
            return (
              <div key={key} className={cn('w-full', kind === 'video' ? 'max-w-md' : 'max-w-sm')}>
                <Suspense
                  fallback={
                    <div className="flex h-10 items-center gap-2 rounded-lg border bg-muted px-3 text-xs text-muted-foreground">
                      <Spinner className="size-3.5" /> Loading player…
                    </div>
                  }
                >
                  <LazyMediaPlayer kind={kind} src={attachment.url} title={attachment.name} />
                </Suspense>
              </div>
            )
          }
          return <FileChip key={key} attachment={attachment} pending={pending} />
        })}
      </div>
      {zoomed ? (
        <ImageLightbox src={zoomed.url} name={zoomed.name} onClose={() => setZoomed(null)} />
      ) : null}
    </>
  )
}

/** An image attachment: the thumbnail plus, on hover, expand + download buttons.
 *  A pending image (local blob, mid-send) has nothing to expand/download yet. */
function ImageThumb({
  attachment,
  pending,
  onOpen
}: {
  attachment: RenderedAttachment
  pending?: boolean
  onOpen: () => void
}): React.JSX.Element {
  return (
    <div className="group/img relative overflow-hidden rounded-lg border">
      <button type="button" onClick={pending ? undefined : onOpen} className="block cursor-zoom-in">
        <img
          src={attachment.url}
          alt={attachment.name}
          className="max-h-64 max-w-xs object-cover"
        />
      </button>
      {!pending ? (
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover/img:opacity-100">
          <HoverButton label="Expand" onClick={onOpen}>
            <ArrowsOut className="size-4" />
          </HoverButton>
          <HoverButton
            label="Download"
            onClick={() => void downloadFile(attachment.url, attachment.name)}
          >
            <DownloadSimple className="size-4" />
          </HoverButton>
        </div>
      ) : null}
    </div>
  )
}

function HoverButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
    >
      {children}
    </button>
  )
}

function ChipButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}

function FileChip({
  attachment,
  pending
}: {
  attachment: RenderedAttachment
  pending?: boolean
}): React.JSX.Element {
  return (
    <div className="flex max-w-xs items-center gap-2.5 rounded-lg border bg-card p-2 pr-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <FileIcon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{attachment.name}</span>
        <span className="block text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>
      </span>
      {!pending && attachment.url ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <ChipButton label="Open" onClick={() => platform.openExternal(attachment.url)}>
            <ArrowsOut className="size-4" />
          </ChipButton>
          <ChipButton
            label="Download"
            onClick={() => void downloadFile(attachment.url, attachment.name)}
          >
            <DownloadSimple className="size-4" />
          </ChipButton>
        </div>
      ) : null}
    </div>
  )
}
