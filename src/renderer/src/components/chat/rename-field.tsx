import { useState } from 'react'

import { cn } from '@renderer/lib/utils'

/** Inline rename input — the sidebar's channel/group rows and the channel header
 *  all swap their label for this while editing.
 *
 *  Enter commits, Escape cancels, blur commits (so clicking away keeps what you
 *  typed rather than silently discarding it). `onSubmit` receives the raw value;
 *  the caller trims it and decides whether anything actually changed. */
export function RenameField({
  initial,
  leading,
  onSubmit,
  onCancel,
  className,
  inputClassName
}: {
  initial: string
  leading?: React.ReactNode
  onSubmit: (name: string) => void
  onCancel: () => void
  className?: string
  inputClassName?: string
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <div className={cn('flex items-center gap-1.5 rounded-md bg-accent px-2 py-1', className)}>
      {leading}
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onSubmit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(value)
          if (e.key === 'Escape') onCancel()
        }}
        // The sidebar rows are drag handles; a pointerdown here must not start one.
        onPointerDown={(e) => e.stopPropagation()}
        className={cn('min-w-0 flex-1 bg-transparent text-sm outline-none', inputClassName)}
      />
    </div>
  )
}
