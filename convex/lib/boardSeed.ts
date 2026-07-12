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
