import { Shuffle, Trash } from '@phosphor-icons/react'
import { EMOJI_GROUPS, randomEmoji } from './emoji-data'

/** Notion-style emoji picker (centered modal). */
export function EmojiPicker({
  onSelect,
  onRemove,
  onClose
}: {
  onSelect: (emoji: string) => void
  onRemove: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border bg-popover p-3 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              onSelect(randomEmoji())
              onClose()
            }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Shuffle className="size-4" />
            Random
          </button>
          <button
            type="button"
            onClick={() => {
              onRemove()
              onClose()
            }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Trash className="size-4" />
            Remove
          </button>
        </div>

        <div className="no-scrollbar max-h-80 overflow-y-auto pr-1">
          {Object.entries(EMOJI_GROUPS).map(([label, emojis]) => (
            <div key={label} className="mb-1">
              <div className="px-1 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {label}
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    title={emoji}
                    onClick={() => {
                      onSelect(emoji)
                      onClose()
                    }}
                    className="flex size-9 items-center justify-center rounded-md text-xl leading-none transition-colors hover:bg-accent"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
