import { createPortal } from 'react-dom'
import { Trash } from '@phosphor-icons/react'
import EmojiPickerReact, { EmojiStyle, Theme } from 'emoji-picker-react'
import { useThemeStore } from '@renderer/store/theme-store'
import { useSettingsStore, type UiScale } from '@renderer/store/settings-store'

// The UI-scale setting is applied as the root font-size; emoji-picker-react is
// px-based, so scale it by the same factor to keep it in step with the app.
const SCALE_FACTOR: Record<UiScale, number> = { xs: 0.75, sm: 0.875, md: 1, lg: 1.125 }

const MAX_WIDTH = 350
const MAX_HEIGHT = 440

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** The bare picker (native emoji-picker-react styling, themed + scaled). Drop it
 *  into a popover/anchored container — it reports a correct layout size, so the
 *  anchor can measure and flip it.
 *
 *  Two subtleties, both learned the hard way:
 *  1. `transform: scale()` does NOT change an element's layout box. Scaling the
 *     picker directly made anchors reserve the *unscaled* size, leaving a large
 *     empty gap around it. So the outer box carries the **scaled** dimensions
 *     while the inner box keeps the picker's natural size and scales from its
 *     top-left corner.
 *  2. The picker is clamped to the viewport (like `GifPicker`'s `60dvh`), so it
 *     can't grow taller than the space it's allowed to occupy. */
export function EmojiPickerPanel({
  onSelect,
  onRemove
}: {
  onSelect: (emoji: string) => void
  onRemove?: () => void
}): React.JSX.Element {
  const theme = useThemeStore((state) => state.theme)
  const uiScale = useSettingsStore((state) => state.uiScale)
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const factor = SCALE_FACTOR[uiScale]

  // Natural (unscaled) size, clamped to the viewport.
  const width = clamp(window.innerWidth - 32, 260, MAX_WIDTH)
  const height = clamp(Math.round(window.innerHeight * 0.6), 280, MAX_HEIGHT)

  return (
    <div className="flex flex-col items-end gap-1.5">
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1 rounded-md border bg-popover px-2 py-1 text-xs font-medium text-muted-foreground shadow-md transition-colors hover:text-foreground"
        >
          <Trash className="size-3.5" />
          Remove
        </button>
      ) : null}
      <div style={{ width: width * factor, height: height * factor }}>
        <div
          style={{
            width,
            height,
            transform: factor !== 1 ? `scale(${factor})` : undefined,
            transformOrigin: 'top left'
          }}
        >
          <EmojiPickerReact
            theme={dark ? Theme.DARK : Theme.LIGHT}
            emojiStyle={EmojiStyle.APPLE}
            lazyLoadEmojis
            autoFocusSearch
            skinTonesDisabled={false}
            previewConfig={{ showPreview: true }}
            width={width}
            height={height}
            onEmojiClick={(emojiData) => onSelect(emojiData.emoji)}
          />
        </div>
      </div>
    </div>
  )
}

/** Centered-overlay variant, for callers with no natural anchor (the page icon).
 *  Portaled to `document.body` so `position: fixed` escapes any transformed
 *  ancestor (e.g. a Base-UI popover positioner). */
export function EmojiPicker({
  onSelect,
  onRemove,
  onClose
}: {
  onSelect: (emoji: string) => void
  onRemove?: () => void
  onClose: () => void
}): React.JSX.Element {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-24"
      onClick={onClose}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <EmojiPickerPanel
          onSelect={(emoji) => {
            onSelect(emoji)
            onClose()
          }}
          onRemove={
            onRemove
              ? () => {
                  onRemove()
                  onClose()
                }
              : undefined
          }
        />
      </div>
    </div>,
    document.body
  )
}
