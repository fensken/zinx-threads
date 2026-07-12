import { useEffect, useState } from 'react'
import { GifPicker, type PickedMediaKind } from '@renderer/components/pickers/gif-picker'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'

/** Editing a GIF/sticker message (mirrors `_zinx`'s `EditGifMessage`): you can't
 *  meaningfully *type* one, so instead of the text editor we show the current
 *  media plus a picker. Save is disabled until you pick a new one. */
export function EditGifMessage({
  src,
  onSave,
  onCancel
}: {
  src: string
  onSave: (url: string, kind: PickedMediaKind) => void
  onCancel: () => void
}): React.JSX.Element {
  const [selected, setSelected] = useState(src)
  const [selectedKind, setSelectedKind] = useState<PickedMediaKind>('gif')
  const [pickerOpen, setPickerOpen] = useState(false)
  const changed = selected.trim() !== src.trim()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pickerOpen) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, pickerOpen])

  return (
    <div className="mx-2 px-2 py-1">
      <div className="flex flex-col gap-2 rounded-xl border border-primary/50 bg-card p-2">
        <img
          src={selected}
          alt="GIF"
          className="max-h-44 w-fit max-w-[280px] rounded-md object-contain"
        />
        <div className="flex items-center">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              title="Change GIF or sticker"
              aria-label="Change GIF or sticker"
              className="flex size-8 items-center justify-center rounded-md text-[11px] font-bold tracking-tight text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              GIF
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-auto rounded-none border-none bg-transparent p-0 shadow-none ring-0"
            >
              <GifPicker
                onSelect={(url, kind) => {
                  setSelected(url)
                  setSelectedKind(kind)
                  setPickerOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={!changed}
              onClick={() => onSave(selected, selectedKind)}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
      <p className="px-1 pt-1 text-xs text-muted-foreground">
        Pick a new GIF or sticker to replace this one · <kbd className="font-sans">Esc</kbd> to
        cancel
      </p>
    </div>
  )
}
