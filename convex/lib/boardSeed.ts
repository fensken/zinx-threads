import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/** Every new `kanban` channel starts with these, so the board isn't an empty
 *  canvas with a single "Add column" button. */
export const DEFAULT_BOARD_COLUMNS = ['Planned', 'To Do', 'In Progress', 'Completed'] as const

export async function seedBoardColumns(
  ctx: MutationCtx,
  options: {
    workspaceId: Id<'workspaces'>
    channelId: Id<'channels'>
    userId: Id<'users'>
  }
): Promise<void> {
  for (let i = 0; i < DEFAULT_BOARD_COLUMNS.length; i++) {
    await ctx.db.insert('kanbanColumns', {
      workspaceId: options.workspaceId,
      channelId: options.channelId,
      title: DEFAULT_BOARD_COLUMNS[i],
      order: i,
      createdBy: options.userId
    })
  }
}

/** A handful of sample cards, so a *seeded* board (in a brand-new workspace) shows how a
 *  board works rather than being empty. Only used by `workspaces.create` — a board you
 *  create yourself opens empty (via `seedBoardColumns` alone). */
const SAMPLE_TASKS: Array<{ column: number; title: string; priority: 'low' | 'medium' | 'high' }> =
  [
    { column: 0, title: 'Draft the launch plan', priority: 'medium' },
    { column: 1, title: 'Design the new landing page', priority: 'high' },
    { column: 1, title: 'Write onboarding docs', priority: 'low' },
    { column: 2, title: 'Build the settings screen', priority: 'medium' },
    { column: 3, title: 'Set up the project board', priority: 'low' }
  ]

export async function seedBoardWithSamples(
  ctx: MutationCtx,
  options: { workspaceId: Id<'workspaces'>; channelId: Id<'channels'>; userId: Id<'users'> }
): Promise<void> {
  await seedBoardColumns(ctx, options)
  const columns = await ctx.db
    .query('kanbanColumns')
    .withIndex('by_channel', (q) => q.eq('channelId', options.channelId))
    .collect()
  columns.sort((a, b) => a.order - b.order)
  const now = Date.now()
  const orderByColumn = new Map<number, number>()
  for (const task of SAMPLE_TASKS) {
    const column = columns[task.column]
    if (!column) continue
    const order = orderByColumn.get(task.column) ?? 0
    orderByColumn.set(task.column, order + 1)
    await ctx.db.insert('kanbanTasks', {
      workspaceId: options.workspaceId,
      channelId: options.channelId,
      columnId: column._id,
      title: task.title,
      priority: task.priority,
      assigneeIds: [],
      labels: [],
      checklist: [],
      order,
      createdBy: options.userId,
      createdAt: now,
      updatedAt: now
    })
  }
}
