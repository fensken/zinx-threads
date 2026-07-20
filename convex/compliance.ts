import { ConvexError, v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { query } from './_generated/server'
import { getMembership, requireUser } from './lib/auth'
import { listRealChannels } from './lib/channels'
import type { QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

/**
 * eDiscovery / compliance **export**. A regulated team needs to be able to produce
 * "everything that was said" for a legal hold or audit. Rather than one giant action
 * return (which a large workspace would blow past), the export is a paginated query the
 * admin UI walks to completion and assembles into a downloadable JSON file client-side.
 *
 * Owner/admin only. **DMs are excluded** — a workspace-level compliance export covers
 * the team's channels, not people's private conversations (the same line retention
 * draws); a DM-inclusive legal hold is a separate, consent-gated feature.
 */

async function requireAdmin(ctx: QueryCtx, workspaceId: Id<'workspaces'>): Promise<void> {
  const user = await requireUser(ctx)
  const membership = await getMembership(ctx, workspaceId, user._id)
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    throw new ConvexError('Only owners and admins can export workspace data')
  }
}

/** Static context for the export header: channels + members, resolved once. */
export const exportMetadata = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    await requireAdmin(ctx, workspaceId)
    const workspace = await ctx.db.get(workspaceId)
    const channels = await listRealChannels(ctx, workspaceId)
    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    const memberRows = await Promise.all(
      members.map(async (m) => {
        const u = await ctx.db.get(m.userId)
        return {
          userId: m.userId as string,
          name: u?.name ?? u?.email ?? 'Unknown',
          email: u?.email ?? '',
          role: m.role,
          joinedAt: m.joinedAt
        }
      })
    )
    return {
      workspace: { name: workspace?.name ?? '', slug: workspace?.slug ?? '' },
      channels: channels.map((c) => ({ id: c._id as string, name: c.name, kind: c.kind })),
      members: memberRows,
      exportedAt: Date.now()
    }
  }
})

/** One page of a single channel's messages for the export (oldest first), enriched with
 *  the author's name so the export is legible standalone. The admin UI walks every
 *  channel from `exportMetadata` × every page. Properly indexed on the channel; a DM is
 *  refused (excluded from a workspace export). */
export const exportMessages = query({
  args: { channelId: v.id('channels'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    const channel = await ctx.db.get(channelId)
    if (!channel) throw new ConvexError('Channel not found')
    if (channel.kind === 'dm') throw new ConvexError('DMs are excluded from workspace exports')
    await requireAdmin(ctx, channel.workspaceId)

    const page = await ctx.db
      .query('messages')
      .withIndex('by_channel_thread_created', (q) =>
        q.eq('channelId', channelId).eq('threadId', undefined)
      )
      .order('asc')
      .paginate(paginationOpts)

    const authorNames = new Map<string, string>()
    const rows = await Promise.all(
      page.page.map(async (message) => {
        const key = message.authorId as string
        let author = authorNames.get(key)
        if (author === undefined) {
          const u = await ctx.db.get(message.authorId)
          author = u?.name ?? u?.email ?? 'Unknown'
          authorNames.set(key, author)
        }
        return {
          id: message._id as string,
          channel: channel.name,
          author,
          body: message.body,
          createdAt: message.createdAt,
          editedAt: message.editedAt
        }
      })
    )
    return { ...page, page: rows }
  }
})
