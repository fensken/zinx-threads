import { useId, useState } from 'react'
import { Camera, Spinner as SpinnerIcon } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'

/** An avatar has no business being larger than this; reject on the client so we
 *  don't spend an upload round-trip on a huge file. */
const MAX_BYTES = 5 * 1024 * 1024

/** An avatar/logo with a working "change image" affordance — a hidden file input
 *  behind a hover overlay + corner camera pip. Picking a file calls `onFile`,
 *  which uploads it; the component owns only the picker, the size/type guard, and
 *  the busy spinner. Wrap the visual (an `Avatar` or a colored logo tile) as
 *  `children`; it should fill via `size-full`.
 *
 *  `onFile` is optional so a mock/no-backend build still renders the visual —
 *  without it the control is inert (no camera cue, no picker). */
export function UploadableAvatar({
  size,
  round = true,
  bordered = false,
  onFile,
  children
}: {
  size: string // tailwind size utility, e.g. 'size-14'
  round?: boolean
  bordered?: boolean
  /** Upload the picked file; resolves when done. A throw is the caller's to
   *  surface (a toast) — this component just stops spinning. */
  onFile?: (file: File) => Promise<void>
  children: React.ReactNode
}): React.JSX.Element {
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const shape = round ? 'rounded-full' : 'rounded-xl'

  if (!onFile) {
    return (
      <div className={cn('relative shrink-0', size)}>
        <div className={cn('size-full overflow-hidden', bordered && 'border border-border', shape)}>
          {children}
        </div>
      </div>
    )
  }

  const pick = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    // Reset so re-picking the same file still fires `change`.
    event.target.value = ''
    if (!file || file.size > MAX_BYTES) return
    setBusy(true)
    try {
      await onFile(file)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('relative shrink-0', size)}>
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={pick}
        className="sr-only"
      />
      <label
        htmlFor={inputId}
        title="Change image"
        className={cn(
          'group relative block size-full cursor-pointer overflow-hidden ring-offset-2 ring-offset-card focus-within:ring-2 focus-within:ring-ring',
          bordered && 'border border-border',
          shape
        )}
      >
        {children}
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity',
            busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          {busy ? (
            <SpinnerIcon className="size-1/3 animate-spin text-white" />
          ) : (
            <Camera className="size-1/3 text-white" />
          )}
        </span>
      </label>
      <span className="pointer-events-none absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card">
        <Camera weight="fill" className="size-3" />
      </span>
    </div>
  )
}
