import { cn } from '@renderer/lib/utils'
import type { Presence } from '@renderer/lib/user-status'

const COLORS: Record<Presence, string> = {
  online: 'bg-emerald-500',
  idle: 'bg-amber-400',
  dnd: 'bg-red-500',
  offline: 'bg-muted-foreground/60'
}

export function PresenceDot({
  presence,
  className
}: {
  presence: Presence
  className?: string
}): React.JSX.Element {
  return <span className={cn('block size-2.5 rounded-full', COLORS[presence], className)} />
}
