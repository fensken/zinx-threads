import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'

// Channel groups = the sidebar's collapsible categories (Discord-style, one
// level — modeled on _zinx's `channelGroup`). Channels reference a group via
// `channels.groupId`; a channel with no group renders ungrouped at the top.

/** Groups in a workspace (by slug), ordered. Null-safe: [] if not a member. */
export const listBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const workspace = await ctx.db
      .query('workspaces')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!workspace) return []
    if (!(await getMembership(ctx, workspace._id, user._id))) return []
    const groups = await ctx.db
      .query('channelGroups')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect()
    return groups.sort((a, b) => a.order - b.order)
  }
})

/** Create a group (member-only), appended after existing groups. */
export const create = mutation({
  args: { workspaceId: v.id('workspaces'), name: v.string() },
  handler: async (ctx, { workspaceId, name }) => {
    const user = await requireUser(ctx)
    if (!(await getMembership(ctx, workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    const trimmed = name.trim()
    if (!trimmed) throw new ConvexError('Group name is required')
    const existing = await ctx.db
      .query('channelGroups')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    return await ctx.db.insert('channelGroups', {
      workspaceId,
      name: trimmed,
      order: existing.length,
      createdBy: user._id
    })
  }
})

/** Rename a group (member-only). */
export const rename = mutation({
  args: { groupId: v.id('channelGroups'), name: v.string() },
  handler: async (ctx, { groupId, name }) => {
    const user = await requireUser(ctx)
    const group = await ctx.db.get(groupId)
    if (!group) throw new ConvexError('Group not found')
    if (!(await getMembership(ctx, group.workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    const trimmed = name.trim()
    if (!trimmed) throw new ConvexError('Group name is required')
    await ctx.db.patch(groupId, { name: trimmed })
  }
})

/** Delete a group (member-only). Its channels are kept, moved to ungrouped. */
export const remove = mutation({
  args: { groupId: v.id('channelGroups') },
  handler: async (ctx, { groupId }) => {
    const user = await requireUser(ctx)
    const group = await ctx.db.get(groupId)
    if (!group) return
    if (!(await getMembership(ctx, group.workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    const channels = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', group.workspaceId))
      .collect()
    for (const channel of channels) {
      if (channel.groupId === groupId) await ctx.db.patch(channel._id, { groupId: undefined })
    }
    await ctx.db.delete(groupId)
  }
})
