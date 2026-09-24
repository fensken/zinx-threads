import { useRef, useState } from 'react'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Spinner } from '@renderer/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { UnsplashPicker } from '@renderer/components/pickers/unsplash-picker'
import { COVER_GRADIENTS } from '@renderer/components/doc/cover-data'
import { MAX_UPLOAD_LABEL, withinUploadLimit } from '@renderer/lib/upload-limits'

/**
 * The doc's cover picker: a gradient gallery, a solid colour, Unsplash, a pasted link, and
 * an upload. Each tab produces one cover VALUE (see `cover-data.ts` for the encoding).
 *
 * `onUpload` is optional and its absence hides the tab — the local (`/local`) editor has no
 * R2 to upload to, and Unsplash needs the Convex action, so `allowUnsplash` hides that one
 * the same way. An affordance that can't work shouldn't be shown.
 */
export function DocCoverPicker({
  open,
  onOpenChange,
  onSelect,
  onUpload,
  allowUnsplash = true
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A cover value: `gradient:<key>` | `color:<#hex>` | an image URL. */
  onSelect: (cover: string) => void
  onUpload?: (file: File) => Promise<void>
  allowUnsplash?: boolean
}): React.JSX.Element {
  const [color, setColor] = useState('#6366f1')
  const [linkUrl, setLinkUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const pick = (value: string): void => {
    onSelect(value)
    onOpenChange(false)
  }

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file || !onUpload) return
    // Say why nothing happened — a silent drop reads as a broken button.
    if (!withinUploadLimit(file.size)) {
      toast.error(`That image is too large (max ${MAX_UPLOAD_LABEL}).`)
      return
    }
    setUploading(true)
    try {
      await onUpload(file)
      onOpenChange(false)
    } catch {
      toast.error("Couldn't upload that image.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A fixed height, so switching tabs doesn't resize the dialog under the pointer. */}
      <DialogContent className="flex max-h-[75dvh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cover image</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="gallery" className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="gallery">Gallery</TabsTrigger>
            <TabsTrigger value="color">Color</TabsTrigger>
            {allowUnsplash ? <TabsTrigger value="unsplash">Unsplash</TabsTrigger> : null}
            <TabsTrigger value="link">Link</TabsTrigger>
            {onUpload ? <TabsTrigger value="upload">Upload</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="gallery" className="no-scrollbar min-h-0 overflow-y-auto">
            <div className="grid grid-cols-4 gap-2 p-1">
              {Object.entries(COVER_GRADIENTS).map(([key, value]) => (
                <Button
                  key={key}
                  type="button"
                  variant="ghost"
                  title={key}
                  aria-label={`${key} gradient`}
                  onClick={() => pick(`gradient:${key}`)}
                  style={{ backgroundImage: value }}
                  className="h-16 w-full rounded-lg p-0 ring-1 ring-border transition-transform hover:scale-[1.03] hover:ring-2 hover:ring-primary"
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="color" className="no-scrollbar min-h-0 overflow-y-auto">
            <div className="doc-color-picker flex w-full flex-col gap-3 p-1">
              <HexColorPicker color={color} onChange={setColor} />
              <div className="flex items-center gap-2">
                <span
                  className="size-9 shrink-0 rounded-md ring-1 ring-border"
                  style={{ backgroundColor: color }}
                />
                <HexColorInput
                  prefixed
                  color={color}
                  onChange={setColor}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase outline-none focus:border-ring"
                />
              </div>
              <Button type="button" onClick={() => pick(`color:${color}`)}>
                Add cover
              </Button>
            </div>
          </TabsContent>

          {allowUnsplash ? (
            <TabsContent value="unsplash" className="min-h-0 overflow-hidden">
              {/* `w-full` overrides the picker's compact popover width; 3 columns suit the
                  dialog. */}
              <UnsplashPicker
                onSelect={(url) => pick(url)}
                columns={3}
                className="h-[min(420px,55dvh)] w-full"
              />
            </TabsContent>
          ) : null}

          <TabsContent value="link" className="no-scrollbar min-h-0 overflow-y-auto">
            <form
              className="flex flex-col gap-2 p-1"
              onSubmit={(event) => {
                event.preventDefault()
                const trimmed = linkUrl.trim()
                if (trimmed) pick(trimmed)
              }}
            >
              <Input
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="Paste an image URL…"
              />
              <p className="text-xs text-muted-foreground">
                Works with any direct image URL (https).
              </p>
              <div className="flex justify-end">
                <Button type="submit" disabled={!linkUrl.trim()}>
                  Add cover
                </Button>
              </div>
            </form>
          </TabsContent>

          {onUpload ? (
            <TabsContent value="upload" className="no-scrollbar min-h-0 overflow-y-auto">
              <div className="p-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    void handleFile(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="h-40 w-full border-dashed hover:border-primary hover:bg-accent/40"
                >
                  {uploading ? (
                    <Spinner className="size-6" />
                  ) : (
                    `Choose an image (max ${MAX_UPLOAD_LABEL})`
                  )}
                </Button>
              </div>
            </TabsContent>
          ) : null}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
