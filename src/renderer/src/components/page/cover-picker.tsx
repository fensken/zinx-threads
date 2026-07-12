import { useRef, useState } from 'react'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import { UploadSimple, X } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import { COVER_GRADIENTS } from '@renderer/components/page/cover-data'
import { UnsplashPicker } from '@renderer/components/pickers/unsplash-picker'
import { Spinner } from '@renderer/components/ui/spinner'

type Tab = 'upload' | 'gallery' | 'color' | 'unsplash' | 'link'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** Notion-style cover picker (centered modal): upload, gradient gallery, solid
 *  color (react-colorful), Unsplash, link. The **Upload** tab appears only when
 *  `onUpload` is provided (the real Convex page editor); it resolves the picked
 *  file to a cover URL and applies it. */
export function CoverPicker({
  onSelect,
  onUpload,
  allowUnsplash = true,
  onClose
}: {
  onSelect: (cover: string) => void
  onUpload?: (file: File) => Promise<void>
  /** Unsplash needs Convex + network; hide it on the offline page editor (default on). */
  allowUnsplash?: boolean
  onClose: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('gallery')
  const [link, setLink] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const upload = async (file: File): Promise<void> => {
    if (!onUpload || file.size > MAX_UPLOAD_BYTES) return
    setUploading(true)
    try {
      await onUpload(file)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-24"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-1 border-b px-2 pt-2">
          <TabButton active={tab === 'gallery'} onClick={() => setTab('gallery')}>
            Gallery
          </TabButton>
          <TabButton active={tab === 'color'} onClick={() => setTab('color')}>
            Color
          </TabButton>
          {allowUnsplash ? (
            <TabButton active={tab === 'unsplash'} onClick={() => setTab('unsplash')}>
              Unsplash
            </TabButton>
          ) : null}
          <TabButton active={tab === 'link'} onClick={() => setTab('link')}>
            Link
          </TabButton>
          {onUpload ? (
            <TabButton active={tab === 'upload'} onClick={() => setTab('upload')}>
              Upload
            </TabButton>
          ) : null}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="my-1 ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {tab === 'upload' && onUpload ? (
          <div className="p-4">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void upload(file)
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary hover:bg-accent/40 hover:text-foreground disabled:opacity-60"
            >
              {uploading ? (
                <Spinner className="size-6" />
              ) : (
                <>
                  <UploadSimple className="size-7" />
                  <span className="font-medium">Upload an image</span>
                  <span className="text-xs">PNG, JPG, GIF or WebP · up to 10&nbsp;MB</span>
                </>
              )}
            </button>
          </div>
        ) : null}

        {tab === 'gallery' ? (
          <div className="no-scrollbar grid grid-cols-4 gap-2 overflow-y-auto p-3">
            {Object.keys(COVER_GRADIENTS).map((key) => (
              <button
                key={key}
                type="button"
                title={key}
                onClick={() => onSelect(`gradient:${key}`)}
                style={{ backgroundImage: COVER_GRADIENTS[key] }}
                className="h-16 rounded-lg ring-1 ring-border transition-transform hover:scale-[1.03] hover:ring-2 hover:ring-primary"
              />
            ))}
          </div>
        ) : null}

        {tab === 'color' ? (
          <div className="flex justify-center p-4">
            {/* One column so the picker, hex field and button all share a width. */}
            <div className="cover-color-picker flex w-full max-w-[280px] flex-col gap-3">
              <HexColorPicker
                color={color}
                onChange={setColor}
                style={{ width: '100%', height: '190px' }}
              />
              <div className="flex items-center gap-2">
                <span
                  className="size-9 shrink-0 rounded-md ring-1 ring-border"
                  style={{ backgroundColor: color }}
                />
                <HexColorInput
                  color={color}
                  onChange={setColor}
                  prefixed
                  className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm uppercase outline-none focus:ring-2 focus:ring-ring/50"
                />
              </div>
              <button
                type="button"
                onClick={() => onSelect(`color:${color}`)}
                className="h-9 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Add cover
              </button>
            </div>
          </div>
        ) : null}

        {allowUnsplash && tab === 'unsplash' ? (
          <UnsplashPicker onSelect={onSelect} columns={3} className="h-[min(440px,60dvh)]" />
        ) : null}

        {tab === 'link' ? (
          <form
            className="flex flex-col gap-2 p-3"
            onSubmit={(event) => {
              event.preventDefault()
              const url = link.trim()
              if (url) onSelect(url)
            }}
          >
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="Paste an image URL…"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!link.trim()}
              className="h-8 self-start rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Add cover
            </button>
            <p className="text-[11px] text-muted-foreground">
              Works with any direct image URL (https).
            </p>
          </form>
        ) : null}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}
