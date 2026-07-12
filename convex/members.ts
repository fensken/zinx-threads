import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { internal } from './_generated/api'
import {
  getAcceptedGuestWorkspaceIds,
  getChannelAccess,
  getCurrentUser,
  getMembership,
  requireUser
} from './lib/auth'

/** Members of a workspace (member-only), each with the user's display fields. */
export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    const enriched = await Promise.all(
      members.map(async (membership) => {
        const u = await ctx.db.get(membership.userId)
        return u
          ? {
              membership,
              user: {
                _id: u._id,
                name: u.name ?? u.email,
                email: u.email,
                color: u.color,
                avatarUrl: u.avatarUrl,
                presence: u.presence,
                statusEmoji: u.statusEmoji,
                statusText: u.statusText
              }
            }
          : null
      })
    )
    return enriched.filter((x): x is NonNullable<typeof x> => x !== null)
  }
})

/** Everyone with access to a channel — the HOST workspace's members plus every
 *  accepted GUEST workspace's members, deduped. Powers cross-workspace `@`-mentions
 *  and profile cards in a shared channel: you can ping anyone who can see it, not
 *  just people in your own workspace. Member/guest-gated via `getChannelAccess`.
 *  For a normal (unshared) channel this is just the host members. */
export const listChannelMembers = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access) return []

    // Host workspace first, then every accepted guest workspace (bounded by
    // MAX_SHARE_GUESTS). A user in two of these appears once — the host entry wins.
    const guestWorkspaceIds = await getAcceptedGuestWorkspaceIds(ctx, channelId)
    const workspaceIds = [access.channel.workspaceId, ...guestWorkspaceIds]

    const seen = new Set<string>()
    const out: Array<{
      userId: string
      name: string
      email: string
      /** `member` for guests — they hold no host role, so never show a crown/admin
       *  badge or count toward `@admins` in someone else's workspace. */
      role: 'owner' | 'admin' | 'member'
      color?: string
      avatarUrl?: string | null
      presence?: string | null
      statusEmoji?: string | null
      statusText?: string | null
      /** The workspace they belong to — for an org badge on cross-workspace people. */
      workspaceName: string
      isHost: boolean
      joinedAt: number
    }> = []

    for (const workspaceId of workspaceIds) {
      const isHost = workspaceId === access.channel.workspaceId
      const workspace = await ctx.db.get(workspaceId)
      const memberships = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .collect()
      for (const membership of memberships) {
        if (seen.has(membership.userId as string)) continue
        seen.add(membership.userId as string)
        const u = await ctx.db.get(membership.userId)
        if (!u) continue
        out.push({
          userId: u._id,
          name: membership.displayName?.trim() || u.name || u.email,
          email: u.email,
          role: isHost ? membership.role : 'member',
          color: u.color,
          avatarUrl: u.avatarUrl,
          presence: u.presence,
          statusEmoji: u.statusEmoji,
          statusText: u.statusText,
          workspaceName: workspace?.name ?? 'Workspace',
          isHost,
          joinedAt: membership._creationTime
        })
      }
    }
    return out
  }
})

/** Change a member's role — owner/admin only; the owner's role is fixed. */
export const updateRole = mutation({
  args: {
    memberId: v.id('workspaceMembers'),
    role: v.union(v.literal('admin'), v.literal('member'))
  },
  handler: async (ctx, { memberId, role }) => {
    const user = await requireUser(ctx)
    const target = await ctx.db.get(memberId)
    if (!target) throw new ConvexError('Member not found')
    const me = await getMembership(ctx, target.workspaceId, user._id)
    if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can change roles')
    }
    if (target.role === 'owner') throw new ConvexError("You can't change the owner's role")
    await ctx.db.patch(memberId, { role })
  }
})

/** Set (or clear) your own per-workspace display name — any member. Blank clears
 *  it, falling back to the account's global name. */
export const updateMyProfile = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    displayName: v.string()
  },
  handler: async (ctx, { workspaceId, displayName }) => {
    const user = await requireUser(ctx)
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership) throw new ConvexError('You are not a member of this workspace')
    const trimmed = displayName.trim().slice(0, 60)
    await ctx.db.patch(membership._id, { displayName: trimmed.length ? trimmed : undefined })
  }
})

/** Remove a member — owner/admin only; the owner can't be removed. */
export const remove = mutation({
  args: { memberId: v.id('workspaceMembers') },
  handler: async (ctx, { memberId }) => {
    const user = await requireUser(ctx)
    const target = await ctx.db.get(memberId)
    if (!target) return
    const me = await getMembership(ctx, target.workspaceId, user._id)
    if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can remove members')
    }
    if (target.role === 'owner') throw new ConvexError("You can't remove the owner")
    await ctx.db.delete(memberId)
    // Drop their read markers + inbox for this workspace (their messages stay).
    await ctx.scheduler.runAfter(0, internal.cleanup.member, {
      workspaceId: target.workspaceId,
      userId: target.userId
    })
  }
})
