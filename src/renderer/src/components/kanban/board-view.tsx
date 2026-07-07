import { useMemo, useState } from 'react'
import { Plus } from '@phosphor-icons/react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Kanban, KanbanBoard, KanbanOverlay } from '@renderer/components/ui/kanban'
import type { Board, KanbanTask } from '@renderer/data/workspaces'
import { TaskDialog } from './task-dialog'
import { TaskBoard } from './task-board'
import { TaskCard } from './task-card'

/** Which task dialog is open, and in what mode. */
type DialogState = { mode: 'create'; columnId: string } | { mode: 'edit'; task: KanbanTask }

/** A blank task used to seed the create dialog's form. */
function blankTask(): KanbanTask {
  return { id: '', title: '', priority: 'medium' }
}

/** Kanban board channel — ported 1:1 from `zinx-os` (dnd-kit `Kanban` primitive +
 *  shadcn cards), adapted to mock data + local `useState`. */
export function BoardView({
  board,
  serverId
}: {
  board: Board
  serverId: string
}): React.JSX.Element {
  const [tasksByColumn, setTasksByColumn] = useState<Record<string, KanbanTask[]>>(() =>
    Object.fromEntries(board.columns.map((column) => [column.id, column.tasks]))
  )
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(board.columns.map((column) => [column.id, column.title]))
  )
  const [dialog, setDialog] = useState<DialogState | null>(null)

  // Column order is the value's key order (the primitive rebuilds it on reorder).
  const columnIds = Object.keys(tasksByColumn)
  const allTasks = useMemo(() => Object.values(tasksByColumn).flat(), [tasksByColumn])

  const mapTasks = (fn: (task: KanbanTask) => KanbanTask | null): void => {
    setTasksByColumn((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([column, tasks]) => [
          column,
          tasks.map(fn).filter((task): task is KanbanTask => task !== null)
        ])
      )
    )
  }

  const updateTask = (id: string, patch: Partial<KanbanTask>): void =>
    mapTasks((task) => (task.id === id ? { ...task, ...patch } : task))

  const deleteTask = (id: string): void => mapTasks((task) => (task.id === id ? null : task))

  const addTask = (columnId: string, fields: Partial<KanbanTask>): void => {
    setTasksByColumn((prev) => ({
      ...prev,
      [columnId]: [
        ...(prev[columnId] ?? []),
        { id: crypto.randomUUID(), title: 'Untitled', priority: 'medium', ...fields }
      ]
    }))
  }

  const addColumn = (title: string): void => {
    const id = crypto.randomUUID()
    setTasksByColumn((prev) => ({ ...prev, [id]: [] }))
    setNames((prev) => ({ ...prev, [id]: title }))
  }

  const renameColumn = (columnId: string, title: string): void =>
    setNames((prev) => ({ ...prev, [columnId]: title }))

  const deleteColumn = (columnId: string): void => {
    setTasksByColumn((prev) => {
      const next = { ...prev }
      delete next[columnId]
      return next
    })
    setNames((prev) => {
      const next = { ...prev }
      delete next[columnId]
      return next
    })
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-muted/20 p-4">
      <Kanban
        value={tasksByColumn}
        onValueChange={setTasksByColumn}
        getItemValue={(task: KanbanTask) => task.id}
        className="h-full"
      >
        <KanbanBoard className="flex h-full items-start gap-4 overflow-x-auto overflow-y-hidden pb-1">
          {columnIds.map((columnId) => (
            <TaskBoard
              key={columnId}
              columnId={columnId}
              name={names[columnId] ?? 'Untitled'}
              tasks={tasksByColumn[columnId] ?? []}
              serverId={serverId}
              onAddTask={(id) => setDialog({ mode: 'create', columnId: id })}
              onOpenTask={(task) => setDialog({ mode: 'edit', task })}
              onDeleteTask={deleteTask}
              onRename={renameColumn}
              onDeleteColumn={deleteColumn}
            />
          ))}
          <AddColumn onAdd={addColumn} />
        </KanbanBoard>

        <KanbanOverlay>
          {({ value, variant }) => {
            if (variant === 'column') {
              const columnId = String(value)
              return (
                <TaskBoard
                  columnId={columnId}
                  name={names[columnId] ?? ''}
                  tasks={tasksByColumn[columnId] ?? []}
                  serverId={serverId}
                  overlay
                />
              )
            }
            const task = allTasks.find((item) => item.id === value)
            return task ? <TaskCard task={task} serverId={serverId} overlay /> : null
          }}
        </KanbanOverlay>
      </Kanban>

      {dialog?.mode === 'create' ? (
        <TaskDialog
          mode="create"
          columnName={names[dialog.columnId]}
          initial={blankTask()}
          serverId={serverId}
          onSubmit={(fields) => addTask(dialog.columnId, fields)}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.mode === 'edit' ? (
        <TaskDialog
          mode="edit"
          initial={dialog.task}
          serverId={serverId}
          onSubmit={(patch) => updateTask(dialog.task.id, patch)}
          onDelete={() => deleteTask(dialog.task.id)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}

function AddColumn({ onAdd }: { onAdd: (title: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const title = value.trim()
    if (!title) return
    onAdd(title)
    setValue('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        className="h-10 w-[280px] shrink-0 justify-center border border-dashed text-muted-foreground sm:w-[320px]"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" weight="bold" />
        Add column
      </Button>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="flex w-[280px] shrink-0 flex-col gap-2 self-start rounded-xl border border-dashed bg-card p-3 sm:w-[320px]"
    >
      <Input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setValue('')
            setOpen(false)
          }
        }}
        placeholder="Column name"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setValue('')
            setOpen(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
