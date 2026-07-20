import { ConvexError, v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { query } from './_generated/server'
import { getMembership, requireUser } from './lib/auth'
import type { QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

/** Owner/admin gate — the audit log is a moderator/compliance surface, never a
 *  member one. Throws `ConvexError` so the client can surface a friendly message. */
async function requireAdmin(ctx: QueryCtx, workspaceId: Id<'workspaces'>): Promise<Id<'users'>> {
  const user = await requireUser(ctx)
  const membership = await getMembership(ctx, workspaceId, user._id)
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    throw new ConvexError('Only owners and admins can view the audit log')
  }
  return user._id
}

/**
 * The paginated audit trail for a workspace, newest first. Owner/admin only.
 * Optionally filtered to one `action` via the compound index (equality on `action`
 * still leaves `createdAt` as the range field — no `.filter()`). Each row is enriched
 * with the actor's display name; the `summary` was already resolved at write time.
 */
export const listByWorkspace = query({
  args: {
    workspaceId: v.id('workspaces'),
    action: v.optional(v.string()),
    paginationOpts: paginationOptsValidator
  },
  handler: async (ctx, { workspaceId, action, paginationOpts }) => {
    await requireAdmin(ctx, workspaceId)

    const page = action
      ? await ctx.db
          .query('auditLogs')
          .withIndex('by_workspace_action_created', (q) =>
            q.eq('workspaceId', workspaceId).eq('action', action)
          )
          .order('desc')
          .paginate(paginationOpts)
      : await ctx.db
          .query('auditLogs')
          .withIndex('by_workspace_created', (q) => q.eq('workspaceId', workspaceId))
          .order('desc')
          .paginate(paginationOpts)

    const actorNames = new Map<string, string>()
    const nameOf = async (actorId: Id<'users'>): Promise<string> => {
      const key = actorId as string
      const hit = actorNames.get(key)
      if (hit !== undefined) return hit
      const u = await ctx.db.get(actorId)
      const name = u?.name ?? u?.email ?? 'Unknown'
      actorNames.set(key, name)
      return name
    }

    const enriched = await Promise.all(
      page.page.map(async (row) => ({
        _id: row._id,
        action: row.action,
        summary: row.summary,
        targetType: row.targetType,
        createdAt: row.createdAt,
        actorId: row.actorId as string,
        actorName: await nameOf(row.actorId)
      }))
    )
    return { ...page, page: enriched }
  }
})
