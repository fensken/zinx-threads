import { ConvexError, v } from 'convex/values'
import { query } from './_generated/server'
import { getMembership, requireUser } from './lib/auth'
import { listRealChannels } from './lib/channels'
import type { QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

/**
 * Admin analytics for a workspace — the "how is my team using this" dashboard an admin
 * expects before committing to a tool. Owner/admin only.
 *
 * Message-volume figures are computed by a **bounded** scan (per-channel + overall caps):
 * exact counts would need a dedicated `messages` index we deliberately don't add to the
 * hottest write table, and a dashboard tolerates "2,000+" where a ledger wouldn't. When
 * the cap is hit, `messagesCapped` is set so the UI can say so honestly rather than
 * implying it counted everything (the no-silent-truncation rule).
 */

const DAY_MS = 86_400_000
const CHANNEL_CAP = 60 // channels scanned for volume
const PER_CHANNEL_CAP = 500 // messages read per channel
const WINDOW_DAYS = 30

async function requireAdmin(ctx: QueryCtx, workspaceId: Id<'workspaces'>): Promise<void> {
  const user = await requireUser(ctx)
  const membership = await getMembership(ctx, workspaceId, user._id)
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    throw new ConvexError('Only owners and admins can view analytics')
  }
}

export const workspaceStats = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    await requireAdmin(ctx, workspaceId)
    const now = Date.now()
    const windowStart = now - WINDOW_DAYS * DAY_MS
    const sevenDaysAgo = now - 7 * DAY_MS

    // Members by role (bounded — a workspace's roster is small enough to collect).
    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    const membersByRole = { owner: 0, admin: 0, member: 0, guest: 0 }
    let bots = 0
    for (const m of members) {
      membersByRole[m.role] += 1
      const u = await ctx.db.get(m.userId)
      if (u?.provider === 'bot') bots += 1
    }

    // Channels by kind.
    const channels = await listRealChannels(ctx, workspaceId)
    const channelsByKind: Record<string, number> = {}
    for (const c of channels) channelsByKind[c.kind] = (channelsByKind[c.kind] ?? 0) + 1

    // Message volume — bounded scan, bucketed into a daily series for the window.
    const series = new Array<number>(WINDOW_DAYS).fill(0)
    let messages7d = 0
    let messages30d = 0
    let messagesCapped = false
    const activeAuthors = new Set<string>()
    const perChannelActivity: Array<{ channelId: string; name: string; count: number }> = []

    const scannable = channels.filter((c) => c.kind === 'chat').slice(0, CHANNEL_CAP)
    if (channels.filter((c) => c.kind === 'chat').length > CHANNEL_CAP) messagesCapped = true

    for (const channel of scannable) {
      const recent = await ctx.db
        .query('messages')
        .withIndex('by_channel_thread_created', (q) =>
          q.eq('channelId', channel._id).eq('threadId', undefined).gte('createdAt', windowStart)
        )
        .order('desc')
        .take(PER_CHANNEL_CAP)
      if (recent.length === PER_CHANNEL_CAP) messagesCapped = true
      let channelCount = 0
      for (const m of recent) {
        messages30d += 1
        channelCount += 1
        activeAuthors.add(m.authorId as string)
        if (m.createdAt >= sevenDaysAgo) messages7d += 1
        const dayIndex = Math.floor((m.createdAt - windowStart) / DAY_MS)
        if (dayIndex >= 0 && dayIndex < WINDOW_DAYS) series[dayIndex] += 1
      }
      if (channelCount > 0) {
        perChannelActivity.push({
          channelId: channel._id as string,
          name: channel.name,
          count: channelCount
        })
      }
    }

    perChannelActivity.sort((a, b) => b.count - a.count)

    return {
      members: { total: members.length, byRole: membersByRole, bots },
      channels: { total: channels.length, byKind: channelsByKind },
      messages: {
        last7Days: messages7d,
        last30Days: messages30d,
        capped: messagesCapped,
        dailySeries: series,
        activeMembers: activeAuthors.size
      },
      topChannels: perChannelActivity.slice(0, 5),
      generatedAt: now
    }
  }
})
