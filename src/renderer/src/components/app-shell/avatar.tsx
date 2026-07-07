import { cn } from '@renderer/lib/utils'
import type { Presence } from '@renderer/data/workspaces'
import { PresenceDot } from './presence-dot'

export function Avatar({
  initials,
  color,
  className,
  presence,
  ringClassName = 'ring-2 ring-background'
}: {
  initials: string
  color: string
  className?: string
  presence?: Presence
  ringClassName?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
        className
      )}
      style={{ backgroundColor: color }}
    >
      {initials}
      {presence ? (
        <PresenceDot
          presence={presence}
          className={cn('absolute -right-0.5 -bottom-0.5 size-3', ringClassName)}
        />
      ) : null}
    </span>
  )
}
