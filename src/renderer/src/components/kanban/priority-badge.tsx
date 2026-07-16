import { Flag } from '@phosphor-icons/react'

import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import type { TaskPriority } from '@renderer/components/kanban/board-types'

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  lowest: 'Lowest',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  highest: 'Highest'
}

// Categorical status colors (an intentional exception to the token rule) — ported
// from the zinx-os priority badge.
const PRIORITY_COLORS: Record<TaskPriority, string> = {
  highest: 'bg-destructive/15 text-destructive border-destructive/25',
  high: 'bg-orange-500/15 text-orange-700 border-orange-500/25 dark:text-orange-400',
  medium: 'bg-warning/15 text-warning border-warning/25',
  low: 'bg-info/15 text-info border-info/25',
  lowest: 'bg-slate-500/15 text-slate-600 border-slate-500/25 dark:text-slate-400'
}

export function PriorityBadge({
  priority,
  className
}: {
  priority: TaskPriority
  className?: string
}): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 gap-1 self-start rounded-sm px-1.5 text-xs capitalize',
        PRIORITY_COLORS[priority],
        className
      )}
    >
      <Flag className="size-3" weight="fill" />
      {PRIORITY_LABEL[priority]}
    </Badge>
  )
}
