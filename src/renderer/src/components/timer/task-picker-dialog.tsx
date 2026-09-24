import { useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { formatCompact } from '@renderer/components/timer/format-duration'
import type { TimerTaskOption } from '@renderer/components/timer/timer-types'

/**
 * Pick a task on **this board** to track.
 *
 * There is no board step: time tracking lives inside a kanban channel, so the board is
 * already decided by where you are. That also avoids the query Convex cannot serve —
 * `kanbanTasks.assigneeIds` is an array and array membership isn't indexable, so a
 * cross-board "my tasks" list would mean reading every board in full.
 */
export function TaskPickerDialog({
  open,
  onOpenChange,
  tasks,
  loading,
  onPick,
  title = 'Start a timer',
  description = 'Pick a task on this board'
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: TimerTaskOption[]
  loading?: boolean
  onPick: (taskId: string) => void
  title?: string
  description?: string
}): React.JSX.Element {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return tasks
    return tasks.filter((task) => task.title.toLowerCase().includes(needle))
  }, [tasks, query])

  const close = (next: boolean): void => {
    if (!next) setQuery('')
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex h-9 items-center gap-2 rounded-md border px-2">
          <MagnifyingGlass className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        {/* A reserved height, so the card doesn't resize as the filter narrows — the same
            rule the ⌘K palette follows. */}
        <div className="no-scrollbar max-h-[50dvh] min-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex min-h-64 items-center justify-center">
              <Spinner className="size-4" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center px-4 text-center">
              <p className="text-sm text-muted-foreground">
                {tasks.length === 0
                  ? 'This board has no tasks yet.'
                  : 'No tasks match that search.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-0.5">
              {filtered.map((task) => (
                <button
                  key={task.taskId}
                  type="button"
                  onClick={() => onPick(task.taskId)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                  {task.estimateMs ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      est. {formatCompact(task.estimateMs)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => close(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
