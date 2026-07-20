import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/** Sample rows for a SEEDED database (a brand-new workspace), so the table shows how it
 *  works. A user-created database channel opens empty (`seedDatabase` alone). */
const SAMPLE_RECORDS: Array<{ name: string; status: string; notes: string }> = [
  { name: 'Design review', status: 'doing', notes: 'Walk through the new mockups' },
  { name: 'Ship v1', status: 'todo', notes: 'Target the end of the month' },
  { name: 'Set up analytics', status: 'done', notes: 'Dashboards are live' }
]

/**
 * Seed a fresh `database` channel so it opens as a usable table, not a blank canvas —
 * the same reasoning as `boardSeed` giving a new kanban its default columns. A Name +
 * Status + Notes schema, a Grid view (the default), and a Kanban view grouped by Status.
 * The renderer keeps a matching notion of these defaults but never re-seeds (seeding is
 * server-side on creation only).
 */
export async function seedDatabase(
  ctx: MutationCtx,
  { channelId }: { channelId: Id<'channels'> }
): Promise<void> {
  await ctx.db.insert('databaseFields', {
    channelId,
    name: 'Name',
    type: 'text',
    order: 0
  })
  const statusField = await ctx.db.insert('databaseFields', {
    channelId,
    name: 'Status',
    type: 'select',
    options: [
      { id: 'todo', label: 'To do', color: '#94a3b8' },
      { id: 'doing', label: 'In progress', color: '#3b82f6' },
      { id: 'done', label: 'Done', color: '#22c55e' }
    ],
    order: 1
  })
  await ctx.db.insert('databaseFields', {
    channelId,
    name: 'Notes',
    type: 'text',
    order: 2
  })

  await ctx.db.insert('databaseViews', {
    channelId,
    name: 'Grid',
    type: 'grid',
    order: 0
  })
  await ctx.db.insert('databaseViews', {
    channelId,
    name: 'Board',
    type: 'kanban',
    config: { groupByFieldId: statusField as string },
    order: 1
  })
}

/** Seed a database AND fill it with sample records — used only by `workspaces.create`. */
export async function seedDatabaseWithSamples(
  ctx: MutationCtx,
  { channelId, userId }: { channelId: Id<'channels'>; userId: Id<'users'> }
): Promise<void> {
  await seedDatabase(ctx, { channelId })
  const fields = await ctx.db
    .query('databaseFields')
    .withIndex('by_channel', (q) => q.eq('channelId', channelId))
    .collect()
  const nameField = fields.find((f) => f.name === 'Name')
  const statusField = fields.find((f) => f.name === 'Status')
  const notesField = fields.find((f) => f.name === 'Notes')
  const now = Date.now()
  for (let i = 0; i < SAMPLE_RECORDS.length; i += 1) {
    const sample = SAMPLE_RECORDS[i]
    const values: Record<string, string> = {}
    if (nameField) values[nameField._id as string] = sample.name
    if (statusField) values[statusField._id as string] = sample.status
    if (notesField) values[notesField._id as string] = sample.notes
    await ctx.db.insert('databaseRecords', {
      channelId,
      values,
      order: i,
      createdBy: userId,
      createdAt: now
    })
  }
}
