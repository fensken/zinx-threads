import { useState } from 'react'
import { DotsSixVertical, Plus, Trash, Tray } from '@phosphor-icons/react'

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import {
  KanbanColumn,
  KanbanColumnContent,
  KanbanColumnHandle
} from '@renderer/components/ui/kanban'
import type { KanbanTask } from '@renderer/components/kanban/board-types'
import { cn } from '@renderer/lib/utils'
import type { BoardMember } from './board-types'
import { TaskCard } from './task-card'

export function TaskBoard({
  columnId,
  name,
  tasks,
  members,
  currentUserId,
  overlay,
  onAddTask,
  onOpenTask,
  onDeleteTask,
  onRename,
  onDeleteColumn
}: {
  columnId: string
  name: string
  tasks: KanbanTask[]
  members: BoardMember[]
  currentUserId: string
  overlay?: boolean
  onAddTask?: (columnId: string) => void
  onOpenTask?: (task: KanbanTask) => void
  onDeleteTask?: (taskId: string) => void
  onRename?: (columnId: string, name: string) => void
  onDeleteColumn?: (columnId: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)

  return (
    <KanbanColumn
      value={columnId}
      className="flex max-h-full w-[280px] shrink-0 flex-col sm:w-[320px]"
    >
      <Card
        data-size="sm"
        className={cn(
          // grow with the task list, but cap at the board height (the inner list
          // then scrolls) — `min-h-0` lets the card shrink so overflow can kick in
          'group/col flex min-h-0 w-full flex-col gap-0 overflow-hidden py-0',
          overlay && 'rotate-2 shadow-xl'
        )}
      >
        <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
          {editing && onRename ? (
            <Input
              autoFocus
              defaultValue={name}
              className="h-6 flex-1 text-sm font-semibold"
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onRename(columnId, event.currentTarget.value.trim() || name)
                  setEditing(false)
                } else if (event.key === 'Escape') {
                  setEditing(false)
                }
              }}
              onBlur={(event) => {
                onRename(columnId, event.currentTarget.value.trim() || name)
                setEditing(false)
              }}
            />
          ) : (
            <span
              className={cn('truncate text-sm font-semibold', onRename && 'cursor-pointer')}
              onDoubleClick={() => onRename && setEditing(true)}
            >
              {name}
            </span>
          )}
          <Badge variant="outline" className="shrink-0">
            {tasks.length}
          </Badge>
          <div className="ml-auto flex items-center gap-0.5">
            {!overlay && onDeleteColumn ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 group-hover/col:opacity-100"
                aria-label="Delete column"
                onClick={() => onDeleteColumn(columnId)}
              >
                <Trash className="size-3.5" />
              </Button>
            ) : null}
            {!overlay ? (
              <KanbanColumnHandle
                render={
                  <Button variant="ghost" size="icon" className="size-6" aria-label="Drag column">
                    <DotsSixVertical className="size-4" weight="bold" />
                  </Button>
                }
              />
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
          <KanbanColumnContent
            value={columnId}
            className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-0.5"
          >
            {tasks.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-8 text-muted-foreground">
                <Tray className="mb-2 size-8 opacity-40" weight="duotone" />
                <p className="text-sm">No tasks yet</p>
              </div>
            ) : (
              tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  members={members}
                  currentUserId={currentUserId}
                  asHandle={!overlay}
                  onOpen={onOpenTask ? () => onOpenTask(task) : undefined}
                  onDelete={onDeleteTask ? () => onDeleteTask(task.id) : undefined}
                />
              ))
            )}
          </KanbanColumnContent>

          {!overlay && onAddTask ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-8 w-full shrink-0 justify-start text-muted-foreground"
              onClick={() => onAddTask(columnId)}
            >
              <Plus className="size-4" weight="bold" />
              Add task
            </Button>
          ) : null}
        </div>
      </Card>
    </KanbanColumn>
  )
}
