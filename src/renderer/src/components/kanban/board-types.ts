// The shapes `BoardView` and its children speak. Deliberately free of Convex ids so
// the presentational board components stay decoupled; `real-board-view` adapts Convex
// docs into these.

export type TaskPriority = 'lowest' | 'low' | 'medium' | 'high' | 'highest'

export interface ChecklistItem {
  id: string
  content: string
  completed: boolean
}

export interface KanbanTask {
  id: string
  title: string
  description?: string
  priority: TaskPriority
  assigneeIds?: string[]
  dueDate?: string // ISO date
  labels?: string[]
  storyPoints?: number
  checklist?: ChecklistItem[]
}

/** Anyone who can be assigned to a task. `id` is opaque to the board. */
export interface BoardMember {
  id: string
  name: string
  initials: string
  color: string
  avatarUrl?: string | null
}

export interface BoardColumn {
  id: string
  title: string
  tasks: KanbanTask[]
}

/** Everything a task dialog can write. `id` is absent when creating. */
export type TaskFields = Omit<KanbanTask, 'id'>

/** Persisted after a drag settles: the column order, and each column's tasks. */
export interface BoardOrder {
  columnIds: string[]
  taskIdsByColumn: Record<string, string[]>
}

/** Mirrors `convex/lib/boardSeed.ts`, which is the authoritative copy — the
 *  renderer can't import server code, and the server can't import the renderer.
 *  Only the demo board reads this; the real one asks Convex to seed. */
export const DEFAULT_BOARD_COLUMNS = ['Planned', 'To Do', 'In Progress', 'Completed'] as const
