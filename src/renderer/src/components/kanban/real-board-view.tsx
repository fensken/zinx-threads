import { useCallback, useMemo } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import type { FunctionReturnType } from 'convex/server'
import { toast } from 'sonner'
import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { BoardSkeleton } from '@renderer/components/common/skeletons'
import { errorMessage } from '@renderer/lib/convex-error'
import { initialsOf } from '@renderer/lib/initials'
import type { KanbanTask } from '@renderer/components/kanban/board-types'
import { BoardView } from './board-view'
import type { BoardColumn, BoardMember, TaskFields } from './board-types'

/** A `kanban` channel, persisted to Convex.
 *
 *  Assignees come from the workspace directory (already subscribed by the shell),
 *  so the board never queries members itself. */
export function RealBoardView({ channel }: { channel: Doc<'channels'> }): React.JSX.Element {
  const board = useQuery(api.boards.getByChannel, { channelId: channel._id })
  const directory = useWorkspaceDirectory()

  const createTask = useMutation(api.boards.createTask)
  const updateTask = useMutation(api.boards.updateTask)
  const removeTask = useMutation(api.boards.removeTask)
  const createColumn = useMutation(api.boards.createColumn)
  const renameColumn = useMutation(api.boards.renameColumn)
  const removeColumn = useMutation(api.boards.removeColumn)
  const seedDefaultColumns = useMutation(api.boards.seedDefaultColumns)
  const reorder = useMutation(api.boards.reorder)

  /** Surface Convex errors instead of swallowing the rejection. */
  const guard = useCallback((action: Promise<unknown>, fallback: string): void => {
    void action.catch((error) => toast.error(errorMessage(error, fallback)))
  }, [])

  const members = useMemo<BoardMember[]>(
    () =>
      (directory?.members ?? []).map((member) => ({
        id: member.userId,
        name: member.name,
        initials: initialsOf(member.name),
        color: member.color,
        avatarUrl: member.avatarUrl
      })),
    [directory?.members]
  )
  const currentUserId = useMemo(
    () => directory?.members.find((member) => member.isMe)?.userId ?? '',
    [directory?.members]
  )

  const columns = useMemo<BoardColumn[]>(
    () =>
      (board ?? []).map((column) => ({
        id: column._id,
        title: column.title,
        tasks: column.tasks.map(toKanbanTask)
      })),
    [board]
  )

  if (board === undefined) return <BoardSkeleton />

  return (
    <BoardView
      columns={columns}
      members={members}
      currentUserId={currentUserId}
      onCreateTask={(columnId, fields) =>
        guard(
          createTask({ columnId: columnId as Id<'kanbanColumns'>, ...toArgs(fields) }),
          'Could not create the task'
        )
      }
      onUpdateTask={(taskId, fields) =>
        guard(
          updateTask({ taskId: taskId as Id<'kanbanTasks'>, ...toArgs(fields) }),
          'Could not save the task'
        )
      }
      onDeleteTask={(taskId) =>
        guard(removeTask({ taskId: taskId as Id<'kanbanTasks'> }), 'Could not delete the task')
      }
      onCreateColumn={(title) =>
        guard(createColumn({ channelId: channel._id, title }), 'Could not create the column')
      }
      onRenameColumn={(columnId, title) =>
        guard(
          renameColumn({ columnId: columnId as Id<'kanbanColumns'>, title }),
          'Could not rename the column'
        )
      }
      onDeleteColumn={(columnId) =>
        guard(
          removeColumn({ columnId: columnId as Id<'kanbanColumns'> }),
          'Could not delete the column'
        )
      }
      onUseDefaultColumns={() =>
        guard(seedDefaultColumns({ channelId: channel._id }), 'Could not add the default columns')
      }
      onReorder={({ columnIds, taskIdsByColumn }) =>
        guard(
          reorder({
            channelId: channel._id,
            columnOrder: columnIds as Id<'kanbanColumns'>[],
            buckets: columnIds.map((columnId) => ({
              columnId: columnId as Id<'kanbanColumns'>,
              taskIds: (taskIdsByColumn[columnId] ?? []) as Id<'kanbanTasks'>[]
            }))
          }),
          'Could not save the new order'
        )
      }
    />
  )
}

type BoardColumnRow = FunctionReturnType<typeof api.boards.getByChannel>[number]

/** Convex row → the shape the presentational board speaks. */
function toKanbanTask(task: BoardColumnRow['tasks'][number]): KanbanTask {
  return {
    id: task._id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    assigneeIds: task.assigneeIds,
    labels: task.labels,
    checklist: task.checklist,
    dueDate: task.dueDate,
    storyPoints: task.storyPoints
  }
}

/** The inverse: the mutations want required arrays, not `undefined`. */
function toArgs(fields: TaskFields): {
  title: string
  description?: string
  priority: KanbanTask['priority']
  assigneeIds: Id<'users'>[]
  labels: string[]
  checklist: { id: string; content: string; completed: boolean }[]
  dueDate?: string
  storyPoints?: number
} {
  return {
    title: fields.title,
    description: fields.description,
    priority: fields.priority,
    assigneeIds: (fields.assigneeIds ?? []) as Id<'users'>[],
    labels: fields.labels ?? [],
    checklist: fields.checklist ?? [],
    dueDate: fields.dueDate,
    storyPoints: fields.storyPoints
  }
}
