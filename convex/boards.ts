import { ConvexError, v } from 'convex/values'
import { query, mutation, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { taskPriority } from './schema'
import { getChannelAccess, getCurrentUser, requireChannelAccess, requireUser } from './lib/auth'
import { seedBoardColumns } from './lib/boardSeed'

/** A board loads whole — there's no pagination in a kanban UI — so bound it. Past
 *  this a board wants swimlane filters, not a bigger `.take()`. */
const MAX_TASKS = 500
const MAX_COLUMNS = 30

// Capped, because these live as arrays *inside* a task document.
const MAX_ASSIGNEES = 20
const MAX_LABELS = 20
const MAX_CHECKLIST = 100

const MAX_TITLE = 200
const MAX_DESCRIPTION = 20_000

const checklistItem = v.object({
  id: v.string(),
  content: v.string(),
  completed: v.boolean()
})

/** The task fields a client may write. `columnId` / `order` move via `reorder`. */
const taskFields = {
  title: v.string(),
  description: v.optional(v.string()),
  priority: taskPriority,
  assigneeIds: v.array(v.id('users')),
  labels: v.array(v.string()),
  checklist: v.array(checklistItem),
  dueDate: v.optional(v.string()),
  storyPoints: v.optional(v.number())
}

type TaskFields = {
  title: string
  description?: string
  priority: Doc<'kanbanTasks'>['priority']
  assigneeIds: Id<'users'>[]
  labels: string[]
  checklist: { id: string; content: string; completed: boolean }[]
  dueDate?: string
  storyPoints?: number
}

/** Reject oversized input at the edge rather than letting a task document creep
 *  toward Convex's 1 MB limit. */
function validateTask(fields: TaskFields): TaskFields {
  const title = fields.title.trim().slice(0, MAX_TITLE)
  if (!title) throw new ConvexError('A task needs a title')
  if ((fields.description?.length ?? 0) > MAX_DESCRIPTION) {
    throw new ConvexError('That description is too long')
  }
  if (fields.assigneeIds.length > MAX_ASSIGNEES) {
    throw new ConvexError(`A task can have at most ${MAX_ASSIGNEES} assignees`)
  }
  if (fields.labels.length > MAX_LABELS) {
    throw new ConvexError(`A task can have at most ${MAX_LABELS} labels`)
  }
  if (fields.checklist.length > MAX_CHECKLIST) {
    throw new ConvexError(`A checklist can have at most ${MAX_CHECKLIST} items`)
  }
  return { ...fields, title }
}

/** Resolve the channel + membership, and refuse a channel that isn't a board —
 *  mirrors `pages.requirePageAccess`. */
async function requireBoardAccess(
  ctx: MutationCtx,
  channelId: Id<'channels'>
): Promise<{ channel: Doc<'channels'>; userId: Id<'users'> }> {
  const user = await requireUser(ctx)
  // `requireChannelAccess` enforces private-channel membership — an admin outside a
  // private board channel can't touch it, matching chat/pages.
  const { channel } = await requireChannelAccess(ctx, channelId, user._id)
  if (channel.kind !== 'kanban') throw new ConvexError('That channel is not a board')
  return { channel, userId: user._id }
}

/** Same, reached through a column. */
async function requireColumn(
  ctx: MutationCtx,
  columnId: Id<'kanbanColumns'>
): Promise<{ column: Doc<'kanbanColumns'>; userId: Id<'users'> }> {
  const user = await requireUser(ctx)
  const column = await ctx.db.get(columnId)
  if (!column) throw new ConvexError('Column not found')
  await requireChannelAccess(ctx, column.channelId, user._id)
  return { column, userId: user._id }
}

/** The whole board: columns in order, each with its tasks in order. Null-safe —
 *  `[]` when you're not a member, so a first-login race can't blow up the UI. */
export const getByChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    // Membership, not role: an admin outside a private board channel sees nothing.
    if (!(await getChannelAccess(ctx, channelId, user._id))) return []

    const columns = await ctx.db
      .query('kanbanColumns')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(MAX_COLUMNS)
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(MAX_TASKS)

    tasks.sort((a, b) => a.order - b.order)
    return columns
      .sort((a, b) => a.order - b.order)
      .map((column) => ({
        _id: column._id,
        title: column.title,
        tasks: tasks.filter((task) => task.columnId === column._id)
      }))
  }
})

/** Seed the default columns (Planned / To Do / In Progress / Completed) into a board that has none.
 *
 *  Deliberately an **explicit action**, not something the board does on read: a
 *  user who deleted every column meant it, and auto-seeding would resurrect them.
 *  `channels.create` seeds new boards; this is for the ones that predate it. */
export const seedDefaultColumns = mutation({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const { channel, userId } = await requireBoardAccess(ctx, channelId)
    const existing = await ctx.db
      .query('kanbanColumns')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(1)
    if (existing.length > 0) throw new ConvexError('This board already has columns')
    await seedBoardColumns(ctx, { workspaceId: channel.workspaceId, channelId, userId })
  }
})

export const createColumn = mutation({
  args: { channelId: v.id('channels'), title: v.string() },
  handler: async (ctx, { channelId, title }) => {
    const { channel, userId } = await requireBoardAccess(ctx, channelId)
    const clean = title.trim().slice(0, MAX_TITLE)
    if (!clean) throw new ConvexError('A column needs a name')

    const existing = await ctx.db
      .query('kanbanColumns')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(MAX_COLUMNS + 1)
    if (existing.length >= MAX_COLUMNS) {
      throw new ConvexError(`A board can have at most ${MAX_COLUMNS} columns`)
    }

    return await ctx.db.insert('kanbanColumns', {
      workspaceId: channel.workspaceId,
      channelId,
      title: clean,
      order: existing.length,
      createdBy: userId
    })
  }
})

export const renameColumn = mutation({
  args: { columnId: v.id('kanbanColumns'), title: v.string() },
  handler: async (ctx, { columnId, title }) => {
    await requireColumn(ctx, columnId)
    const clean = title.trim().slice(0, MAX_TITLE)
    if (!clean) throw new ConvexError('A column needs a name')
    await ctx.db.patch(columnId, { title: clean })
  }
})

/** Deleting a column deletes its tasks — they have nowhere else to live. */
export const removeColumn = mutation({
  args: { columnId: v.id('kanbanColumns') },
  handler: async (ctx, { columnId }) => {
    await requireColumn(ctx, columnId)
    const tasks = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_column_order', (q) => q.eq('columnId', columnId))
      .take(MAX_TASKS)
    for (const task of tasks) await ctx.db.delete(task._id)
    await ctx.db.delete(columnId)
  }
})

export const createTask = mutation({
  args: { columnId: v.id('kanbanColumns'), ...taskFields },
  handler: async (ctx, { columnId, ...fields }) => {
    const { column, userId } = await requireColumn(ctx, columnId)
    const clean = validateTask(fields)

    const siblings = await ctx.db
      .query('kanbanTasks')
      .withIndex('by_column_order', (q) => q.eq('columnId', columnId))
      .take(MAX_TASKS + 1)
    if (siblings.length >= MAX_TASKS) throw new ConvexError('This board is full')

    const now = Date.now()
    return await ctx.db.insert('kanbanTasks', {
      workspaceId: column.workspaceId,
      channelId: column.channelId,
      columnId,
      ...clean,
      order: siblings.length,
      createdBy: userId,
      createdAt: now,
      updatedAt: now
    })
  }
})

export const updateTask = mutation({
  args: { taskId: v.id('kanbanTasks'), ...taskFields },
  handler: async (ctx, { taskId, ...fields }) => {
    const user = await requireUser(ctx)
    const task = await ctx.db.get(taskId)
    if (!task) throw new ConvexError('Task not found')
    await requireChannelAccess(ctx, task.channelId, user._id)
    await ctx.db.patch(taskId, { ...validateTask(fields), updatedAt: Date.now() })
  }
})

export const removeTask = mutation({
  args: { taskId: v.id('kanbanTasks') },
  handler: async (ctx, { taskId }) => {
    const user = await requireUser(ctx)
    const task = await ctx.db.get(taskId)
    if (!task) return
    await requireChannelAccess(ctx, task.channelId, user._id)
    await ctx.db.delete(taskId)
  }
})

/** One call after a drag settles: the new column order, plus each column's task
 *  order and membership. Mirrors `channels.reorder` — the board fires
 *  `onValueChange` continuously while dragging, so it persists once on drop. */
export const reorder = mutation({
  args: {
    channelId: v.id('channels'),
    columnOrder: v.array(v.id('kanbanColumns')),
    buckets: v.array(
      v.object({
        columnId: v.id('kanbanColumns'),
        taskIds: v.array(v.id('kanbanTasks'))
      })
    )
  },
  handler: async (ctx, { channelId, columnOrder, buckets }) => {
    // Gate on membership + `kind === 'kanban'`; nothing else is needed from it.
    await requireBoardAccess(ctx, channelId)

    for (let i = 0; i < columnOrder.length; i++) {
      const column = await ctx.db.get(columnOrder[i])
      if (column && column.channelId === channelId) {
        await ctx.db.patch(columnOrder[i], { order: i })
      }
    }

    for (const bucket of buckets) {
      // A task can only move into a column on the same board.
      const column = await ctx.db.get(bucket.columnId)
      if (!column || column.channelId !== channelId) {
        throw new ConvexError('That column is not on this board')
      }
      for (let i = 0; i < bucket.taskIds.length; i++) {
        const task = await ctx.db.get(bucket.taskIds[i])
        if (task && task.channelId === channelId) {
          await ctx.db.patch(bucket.taskIds[i], { columnId: bucket.columnId, order: i })
        }
      }
    }
  }
})
