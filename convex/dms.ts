import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'
import { resolveAuthors } from './lib/messages'

/** You + this many others. Slack's group-DM ceiling is 8 others; same here. A
 *  bigger conversation wants a (private) channel, which is what both apps say. */
const MAX_DM_MEMBERS = 9

/** How many DM conversations the sidebar loads. Far above any real list — a person
 *  has as many DMs as there are people they've talked to, not as there are messages. */
const MAX_DMS = 200

/** The identity of a conversation: its participants, deduped + sorted, so the same
 *  set of people always maps to the same key regardless of who opened it or in what
 *  order they were picked. */
function dmKeyOf(userIds: Id<'users'>[]): string {
  return [...new Set(userIds.map(String))].sort().join('_')
}

/** Open the conversation with these people, creating it only if it doesn't exist —
 *  "open", not "create", because clicking Message twice must land in the same place,
 *  not spawn a second empty conversation. Returns the channel id either way.
 *
 *  Every participant must be a member of this workspace: a crafted `zinx://user/<id>`
 *  can't pull in a stranger, and the DM can't span workspaces (a shared channel is
 *  the cross-org surface, not a DM). */
export const open = mutation({
  args: { workspaceId: v.id('workspaces'), userIds: v.array(v.id('users')) },
  handler: async (ctx, { workspaceId, userIds }) => {
    const user = await requireUser(ctx)
    if (!(await getMembership(ctx, workspaceId, user._id))) {
      throw new ConvexError('Join this workspace to start a conversation')
    }

    const others = [...new Set(userIds)].filter((id) => id !== user._id)
    if (others.length === 0) throw new ConvexError('Pick someone to message')
    if (others.length + 1 > MAX_DM_MEMBERS) {
      throw new ConvexError(`A group message holds at most ${MAX_DM_MEMBERS} people`)
    }
    for (const id of others) {
      if (!(await getMembership(ctx, workspaceId, id))) {
        throw new ConvexError('That person is not in this workspace')
      }
    }

    const participants = [user._id, ...others]
    const dmKey = dmKeyOf(participants)

    const existing = await ctx.db
      .query('channels')
      .withIndex('by_workspace_dm_key', (q) => q.eq('workspaceId', workspaceId).eq('dmKey', dmKey))
      .unique()
    if (existing) return existing._id

    const channelId = await ctx.db.insert('channels', {
      workspaceId,
      // Internal, never rendered: the header and the sidebar row show the people.
      // Derived from `dmKey` so it can't collide with a real channel's slug, which
      // keeps the "name is unique within the workspace" invariant true for free.
      name: `dm-${dmKey}`,
      kind: 'dm',
      dmKey,
      order: 0,
      createdBy: user._id
    })
    const now = Date.now()
    for (const userId of participants) {
      await ctx.db.insert('dmMembers', { channelId, workspaceId, userId, createdAt: now })
    }
    return channelId
  }
})

export interface DmSummary {
  channelId: Id<'channels'>
  /** Everyone but you — who the row is *about*. Empty only for a corrupt row. */
  others: Array<{
    userId: Id<'users'>
    name: string
    color?: string
    avatarUrl?: string
    presence?: string
    statusEmoji?: string
    statusText?: string
  }>
  lastMessageAt: number
}

/** Every conversation you're in, most recently active first — the sidebar's "Direct
 *  messages" section, and the source the DM page resolves its channel from (so
 *  switching between DMs reads from the same cached subscription instead of
 *  refetching, exactly as the channel list does for channels). */
export const listMine = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }): Promise<DmSummary[]> => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const mine = await ctx.db
      .query('dmMembers')
      .withIndex('by_user_workspace', (q) =>
        q.eq('userId', user._id).eq('workspaceId', workspaceId)
      )
      .take(MAX_DMS)

    const summaries: DmSummary[] = []
    for (const row of mine) {
      const channel = await ctx.db.get(row.channelId)
      if (!channel) continue

      // Bounded by MAX_DM_MEMBERS.
      const participants = await ctx.db
        .query('dmMembers')
        .withIndex('by_channel', (q) => q.eq('channelId', channel._id))
        .collect()
      const otherIds = participants.map((p) => p.userId).filter((id) => id !== user._id)
      // The workspace nickname wins over the account name, same as in the message
      // list — one person reads the same everywhere in a workspace.
      const people = await resolveAuthors(ctx, workspaceId, otherIds)

      summaries.push({
        channelId: channel._id,
        others: otherIds.map((userId) => {
          const person = people.get(userId)
          return {
            userId,
            name: person?.name ?? 'Unknown',
            color: person?.color,
            avatarUrl: person?.avatarUrl,
            presence: person?.presence,
            statusEmoji: person?.statusEmoji,
            statusText: person?.statusText
          }
        }),
        // A brand-new conversation has no message yet; sort it as if it were sent
        // now, so the DM you just opened is at the top rather than the bottom.
        lastMessageAt:
          (
            await ctx.db
              .query('channelActivity')
              .withIndex('by_channel', (q) => q.eq('channelId', channel._id))
              .unique()
          )?.lastMessageAt ??
          channel.lastMessageAt ??
          channel._creationTime
      })
    }

    return summaries.sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  }
})
