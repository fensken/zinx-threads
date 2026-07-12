import { useLocalStore } from '@renderer/store/local-store'
import { BoardView } from '@renderer/components/kanban/board-view'

/** A local (offline) kanban board — the presentational `BoardView` driven by the
 *  local store. No members (offline has no account), so tasks can't be assigned. */
export function LocalBoardView({ channelId }: { channelId: string }): React.JSX.Element {
  const board = useLocalStore((state) => state.boards[channelId])
  const createTask = useLocalStore((state) => state.createTask)
  const updateTask = useLocalStore((state) => state.updateTask)
  const deleteTask = useLocalStore((state) => state.deleteTask)
  const createColumn = useLocalStore((state) => state.createColumn)
  const renameColumn = useLocalStore((state) => state.renameColumn)
  const deleteColumn = useLocalStore((state) => state.deleteColumn)
  const seedDefaultColumns = useLocalStore((state) => state.seedDefaultColumns)
  const reorderBoard = useLocalStore((state) => state.reorderBoard)

  return (
    <BoardView
      columns={board?.columns ?? []}
      members={[]}
      currentUserId=""
      onCreateTask={(columnId, fields) => createTask(channelId, columnId, fields)}
      onUpdateTask={(taskId, fields) => updateTask(channelId, taskId, fields)}
      onDeleteTask={(taskId) => deleteTask(channelId, taskId)}
      onCreateColumn={(title) => createColumn(channelId, title)}
      onRenameColumn={(columnId, title) => renameColumn(channelId, columnId, title)}
      onDeleteColumn={(columnId) => deleteColumn(channelId, columnId)}
      onUseDefaultColumns={() => seedDefaultColumns(channelId)}
      onReorder={(order) => reorderBoard(channelId, order)}
    />
  )
}
