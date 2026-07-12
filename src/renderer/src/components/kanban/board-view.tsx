import { useEffect, useMemo, useState } from 'react'
import { Kanban as Kanban2, Plus } from '@phosphor-icons/react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Kanban, KanbanBoard, KanbanOverlay } from '@renderer/components/ui/kanban'
import type { KanbanTask } from '@renderer/components/kanban/board-types'
import {
  DEFAULT_BOARD_COLUMNS,
  type BoardColumn,
  type BoardMember,
  type BoardOrder,
  type TaskFields
} from './board-types'
import { TaskDialog } from './task-dialog'
import { TaskBoard } from './task-board'
import { TaskCard } from './task-card'

/** Which task dialog is open, and in what mode. */
type DialogState = { mode: 'create'; columnId: string } | { mode: 'edit'; task: KanbanTask }

/** A blank task used to seed the create dialog's form. */
function blankTask(): KanbanTask {
  return { id: '', title: '', priority: 'medium' }
}

/** Column order + each column's task order, as one comparable string. */
function layoutSignature(value: Record<string, KanbanTask[]>): string {
  return Object.entries(value)
    .map(([columnId, tasks]) => `${columnId}:${tasks.map((task) => task.id).join(',')}`)
    .join('|')
}

/** Kanban board channel — ported 1:1 from `zinx-os` (dnd-kit `Kanban` primitive +
 *  shadcn cards).
 *
 *  **Presentational.** `columns` is the source of truth and every mutation goes
 *  out through a handler, so the same component renders the in-session demo board
 *  (`mock-board-view`) and the Convex one (`real-board-view`). It knows nothing
 *  about the mock getters or about Convex ids.
 *
 *  Drag state is local while a drag is in flight — the `Kanban` primitive fires
 *  `onValueChange` on every pointer move — and `onReorder` is called once, on
 *  drop. Between drags, `columns` from the parent wins. */
export function BoardView({
  columns,
  members,
  currentUserId,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onCreateColumn,
  onRenameColumn,
  onDeleteColumn,
  onReorder,
  onUseDefaultColumns
}: {
  columns: BoardColumn[]
  members: BoardMember[]
  currentUserId: string
  onCreateTask: (columnId: string, fields: TaskFields) => void
  onUpdateTask: (taskId: string, fields: TaskFields) => void
  onDeleteTask: (taskId: string) => void
  onCreateColumn: (title: string) => void
  onRenameColumn: (columnId: string, title: string) => void
  onDeleteColumn: (columnId: string) => void
  onReorder: (order: BoardOrder) => void
  /** Offered only on an empty board — see `EmptyBoard`. */
  onUseDefaultColumns: () => void
}): React.JSX.Element {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  /** The optimistic layout, kept from the first drag move until the server echoes
   *  it back. Dropping it on `onDragEnd` would snap the board to stale data for
   *  the length of the round-trip. */
  const [local, setLocal] = useState<Record<string, KanbanTask[]> | null>(null)

  const names = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.id, column.title])),
    [columns]
  )
  const serverValue = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.id, column.tasks])),
    [columns]
  )
  const serverSignature = useMemo(() => layoutSignature(serverValue), [serverValue])

  // Release the optimistic layout once the server's own layout changes — the same
  // `[signature]`-guarded mirror the channel sidebar uses for its DnD state. A
  // single set, so it can't cascade.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(null)
  }, [serverSignature])

  // The primitive's `value` key order *is* the column order.
  const value = local ?? serverValue
  const columnIds = Object.keys(value)
  const allTasks = useMemo(() => Object.values(value).flat(), [value])

  if (columnIds.length === 0) {
    return <EmptyBoard onUseDefaults={onUseDefaultColumns} onAdd={onCreateColumn} />
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-muted/20 p-4">
      <Kanban
        value={value}
        // Fires on every pointer move during a drag, so it only touches local state.
        onValueChange={setLocal}
        onDragEnd={() => {
          if (!local || layoutSignature(local) === serverSignature) return
          onReorder({
            columnIds: Object.keys(local),
            taskIdsByColumn: Object.fromEntries(
              Object.entries(local).map(([columnId, tasks]) => [
                columnId,
                tasks.map((task) => task.id)
              ])
            )
          })
        }}
        getItemValue={(task: KanbanTask) => task.id}
        className="h-full"
      >
        <KanbanBoard className="flex h-full items-start gap-4 overflow-x-auto overflow-y-hidden pb-1">
          {columnIds.map((columnId) => (
            <TaskBoard
              key={columnId}
              columnId={columnId}
              name={names[columnId] ?? 'Untitled'}
              tasks={value[columnId] ?? []}
              members={members}
              currentUserId={currentUserId}
              onAddTask={(id) => setDialog({ mode: 'create', columnId: id })}
              onOpenTask={(task) => setDialog({ mode: 'edit', task })}
              onDeleteTask={onDeleteTask}
              onRename={onRenameColumn}
              onDeleteColumn={onDeleteColumn}
            />
          ))}
          <AddColumn onAdd={onCreateColumn} />
        </KanbanBoard>

        <KanbanOverlay>
          {({ value: dragged, variant }) => {
            if (variant === 'column') {
              const columnId = String(dragged)
              return (
                <TaskBoard
                  columnId={columnId}
                  name={names[columnId] ?? ''}
                  tasks={value[columnId] ?? []}
                  members={members}
                  currentUserId={currentUserId}
                  overlay
                />
              )
            }
            const task = allTasks.find((item) => item.id === dragged)
            return task ? (
              <TaskCard task={task} members={members} currentUserId={currentUserId} overlay />
            ) : null
          }}
        </KanbanOverlay>
      </Kanban>

      {dialog?.mode === 'create' ? (
        <TaskDialog
          mode="create"
          columnName={names[dialog.columnId]}
          initial={blankTask()}
          members={members}
          onSubmit={(fields) => onCreateTask(dialog.columnId, toFields(fields))}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.mode === 'edit' ? (
        <TaskDialog
          // Keyed: the description editor reads `initialMarkdown` once, at mount.
          key={dialog.task.id}
          mode="edit"
          initial={dialog.task}
          members={members}
          onSubmit={(fields) =>
            onUpdateTask(dialog.task.id, toFields({ ...dialog.task, ...fields }))
          }
          onDelete={() => onDeleteTask(dialog.task.id)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}

/** A board with no columns. New kanban channels are seeded with the defaults at
 *  creation, so this is reached by boards that predate the seeding, or by someone
 *  who deleted every column. Offering the defaults as a *button* rather than
 *  re-seeding on read means the second case stays deleted. */
function EmptyBoard({
  onUseDefaults,
  onAdd
}: {
  onUseDefaults: () => void
  onAdd: (title: string) => void
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-muted/20 p-8 text-center">
      <Kanban2 className="size-9 text-muted-foreground opacity-40" weight="duotone" />
      <div>
        <p className="text-lg font-semibold">This board is empty</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Start with {DEFAULT_BOARD_COLUMNS.join(' · ')}, or make your own.
        </p>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Button onClick={onUseDefaults}>Use the default columns</Button>
        <AddColumn onAdd={onAdd} />
      </div>
    </div>
  )
}

/** The dialog reports a `Partial<KanbanTask>`; the handlers want a whole task. */
function toFields(task: Partial<KanbanTask>): TaskFields {
  return {
    title: task.title ?? 'Untitled',
    description: task.description,
    priority: task.priority ?? 'medium',
    assigneeIds: task.assigneeIds,
    labels: task.labels,
    checklist: task.checklist,
    dueDate: task.dueDate,
    storyPoints: task.storyPoints
  }
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
