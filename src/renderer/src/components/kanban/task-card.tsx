import { CalendarBlank, ListChecks, Trash } from '@phosphor-icons/react'

import { Avatar, AvatarFallback } from '@renderer/components/ui/avatar'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { KanbanItem, KanbanItemHandle } from '@renderer/components/ui/kanban'
import { currentUser, getMember, type KanbanTask, type Member } from '@renderer/data/workspaces'
import { cn } from '@renderer/lib/utils'
import { PriorityBadge } from './priority-badge'

/** Due-date label + urgency color (overdue = red, due today/tomorrow = amber). */
function dueInfo(dueDate: string): { label: string; cls: string } {
  const [y, m, d] = dueDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const diff = Math.round((date.getTime() - startToday) / 86_400_000)
  const cls =
    diff < 0
      ? 'text-red-600 dark:text-red-400'
      : diff <= 1
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-muted-foreground'
  return { label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls }
}

export function TaskCard({
  task,
  serverId,
  onOpen,
  onDelete,
  asHandle,
  overlay
}: {
  task: KanbanTask
  serverId: string
  onOpen?: () => void
  onDelete?: () => void
  asHandle?: boolean
  overlay?: boolean
}): React.JSX.Element {
  const assignees = (task.assigneeIds ?? [])
    .map((id) => getMember(serverId, id))
    .filter((member): member is Member => member !== undefined)
  const isMine = task.assigneeIds?.includes(currentUser.id) ?? false
  const due = task.dueDate ? dueInfo(task.dueDate) : null
  const hasBody = !!task.description
  const checklistTotal = task.checklist?.length ?? 0
  const checklistDone = task.checklist?.filter((item) => item.completed).length ?? 0

  const card = (
    <Card
      className={cn(
        'transition-shadow hover:shadow-md',
        onOpen && 'cursor-pointer',
        overlay && 'rotate-2 shadow-xl',
        isMine && 'border-l-2 border-l-primary'
      )}
    >
      <CardContent className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <span
            role="button"
            tabIndex={overlay ? -1 : 0}
            className="line-clamp-2 flex-1 text-sm font-medium hover:underline"
            onClick={() => !overlay && onOpen?.()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (!overlay) onOpen?.()
              }
            }}
          >
            {task.title}
          </span>
          {!overlay && onDelete ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete task"
              onClick={(event) => {
                event.stopPropagation()
                onDelete()
              }}
            >
              <Trash className="size-3.5" />
            </Button>
          ) : null}
        </div>

        {task.description ? (
          <p className="line-clamp-3 text-xs text-muted-foreground">{task.description}</p>
        ) : null}

        <div className={cn('flex flex-col gap-2', hasBody && 'border-t pt-2.5')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={task.priority} />
            {task.labels?.slice(0, 3).map((label) => (
              <Badge
                key={label}
                variant="secondary"
                className="h-5 rounded-sm px-1.5 text-xs font-normal"
              >
                {label}
              </Badge>
            ))}
            {task.labels && task.labels.length > 3 ? (
              <Badge variant="secondary" className="h-5 rounded-sm px-1.5 text-xs font-normal">
                +{task.labels.length - 3}
              </Badge>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {assignees.length === 0 ? (
                <span className="text-xs text-muted-foreground">Unassigned</span>
              ) : assignees.length === 1 ? (
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar className="size-5">
                    <AvatarFallback
                      className="text-[9px] font-semibold text-white"
                      style={{ backgroundColor: assignees[0].color }}
                    >
                      {assignees[0].initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-xs text-muted-foreground">
                    {assignees[0].name}
                  </span>
                </span>
              ) : (
                <div className="flex items-center -space-x-1.5">
                  {assignees.slice(0, 3).map((member) => (
                    <Avatar key={member.id} className="size-5 ring-2 ring-card">
                      <AvatarFallback
                        className="text-[9px] font-semibold text-white"
                        style={{ backgroundColor: member.color }}
                      >
                        {member.initials}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {assignees.length > 3 ? (
                    <span className="grid size-5 place-items-center rounded-full bg-muted text-[9px] font-medium ring-2 ring-card">
                      +{assignees.length - 3}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {checklistTotal > 0 ? (
                <span
                  className={cn(
                    'flex items-center gap-1 tabular-nums',
                    checklistDone === checklistTotal && 'text-emerald-600 dark:text-emerald-400'
                  )}
                >
                  <ListChecks
                    className="size-3.5"
                    weight={checklistDone === checklistTotal ? 'fill' : 'regular'}
                  />
                  {checklistDone}/{checklistTotal}
                </span>
              ) : null}
              {task.storyPoints != null ? (
                <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-xs tabular-nums">
                  {task.storyPoints} pt{task.storyPoints === 1 ? '' : 's'}
                </Badge>
              ) : null}
              {due ? (
                <time
                  className={cn('flex items-center gap-1 whitespace-nowrap tabular-nums', due.cls)}
                >
                  <CalendarBlank className="size-3" />
                  {due.label}
                </time>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <KanbanItem value={task.id}>
      {asHandle && !overlay ? <KanbanItemHandle render={card} /> : card}
    </KanbanItem>
  )
}
