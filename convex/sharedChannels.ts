import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import {
  getChannelAccess,
  getCurrentUser,
  getMemberships,
  getMembership,
  requireUser
} from './lib/auth'
import { rateLimiter } from './rateLimiter'

// Cross-workspace shared channels (Slack Connect). A channel's OWNER workspace
// invites a GUEST workspace; the guest's owner accepts; the guest's members then
// get access via `lib/auth.ts` `getChannelAccess`. The owner workspace is in charge
// (moderation + add/remove guests); the guest can post + manage its own messages +
// leave. See the `channelShares` table in schema.ts.

/** A channel can be shared with at most this many workspaces — bounds the access
 *  check + notification fan-out. Past this you want proper federation, not a bigger
 *  `.take()`. */
const MAX_SHARE_GUESTS = 20

/** ~120-bit token for the emailed accept link (`/connect/<token>`). */
function makeToken(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 24; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

/** The caller must be an owner/admin of a workspace. */
function isManager(membership: Doc<'workspaceMembers'> | null): boolean {
  return membership?.role === 'owner' || membership?.role === 'admin'
}

/** Invite another workspace (by slug) to a channel. Owner/admin of the channel's
 *  HOST workspace only. Creates a `pending` share the guest workspace's owner then
 *  accepts. Email delivery (optional) is scheduled by the caller path in P4. */
export const invite = mutation({
  args: { channelId: v.id('channels'), guestSlug: v.string() },
  handler: async (ctx, { channelId, guestSlug }) => {
    const user = await requireUser(ctx)
    const channel = await ctx.db.get(channelId)
    if (!channel) throw new ConvexError('Channel not found')
    // Only chat channels are shareable for now.
    if (channel.kind !== 'chat') throw new ConvexError('Only chat channels can be shared')
    if (channel.isDefault) throw new ConvexError('The home channel cannot be shared')

    const membership = await getMembership(ctx, channel.workspaceId, user._id)
    if (!isManager(membership)) {
      throw new ConvexError('Only owners and admins can share a channel')
    }
    // Sends a real email → tight per-user limit against spam / cost.
    await rateLimiter.limit(ctx, 'channelShareInvite', { key: user._id, throws: true })

    const guest = await ctx.db
      .query('workspaces')
      .withIndex('by_slug', (q) => q.eq('slug', guestSlug.trim().toLowerCase()))
      .unique()
    if (!guest) throw new ConvexError('No workspace found with that address')
    if (guest._id === channel.workspaceId) {
      throw new ConvexError('A channel is already available to its own workspace')
    }

    // Idempotent: reuse an existing pending/accepted share for this pair.
    const existing = await ctx.db
      .query('channelShares')
      .withIndex('by_channel_guest', (q) =>
        q.eq('channelId', channelId).eq('guestWorkspaceId', guest._id)
      )
      .unique()
    if (existing) {
      return { shareId: existing._id, status: existing.status, guestWorkspaceId: guest._id }
    }

    const shares = await ctx.db
      .query('channelShares')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .collect()
    if (shares.length >= MAX_SHARE_GUESTS) {
      throw new ConvexError(`A channel can be shared with at most ${MAX_SHARE_GUESTS} workspaces`)
    }

    const token = makeToken()
    const shareId = await ctx.db.insert('channelShares', {
      channelId,
      ownerWorkspaceId: channel.workspaceId,
      guestWorkspaceId: guest._id,
      status: 'pending',
      invitedBy: user._id,
      token,
      createdAt: Date.now()
    })

    // Email the guest workspace's owner an ACCEPT LINK (`/connect/<token>`) — in-app
    // is still the primary path (it shows in their invitations regardless). Both are
    // gated on being that workspace's owner. Best-effort: no email, no send.
    const ownerWorkspace = await ctx.db.get(channel.workspaceId)
    const guestOwner = await ctx.db.get(guest.ownerId)
    if (guestOwner?.email && ownerWorkspace) {
      await ctx.scheduler.runAfter(0, internal.email.sendChannelShareInvite, {
        to: guestOwner.email,
        ownerWorkspaceName: ownerWorkspace.name,
        guestWorkspaceName: guest.name,
        channelName: channel.name,
        inviterName: user.name ?? 'Someone',
        token
      })
    }

    return { shareId, status: 'pending' as const, guestWorkspaceId: guest._id }
  }
})

/** Pending channel-share invites addressed to a workspace the caller OWNS — the
 *  in-app "another workspace invited you to a shared channel" surface. */
export const listPendingForMe = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const ownedWorkspaceIds = (await getMemberships(ctx, user._id))
      .filter((m) => m.role === 'owner')
      .map((m) => m.workspaceId)

    const rows: Array<{
      _id: Id<'channelShares'>
      channelId: Id<'channels'>
      channelName: string
      guestWorkspaceId: Id<'workspaces'>
      guestWorkspaceName: string
      ownerWorkspaceName: string
      inviterName: string
      createdAt: number
    }> = []
    for (const wsId of ownedWorkspaceIds) {
      const pending = await ctx.db
        .query('channelShares')
        .withIndex('by_guest_status', (q) => q.eq('guestWorkspaceId', wsId).eq('status', 'pending'))
        .collect()
      for (const share of pending) {
        const [channel, guest, owner, inviter] = await Promise.all([
          ctx.db.get(share.channelId),
          ctx.db.get(share.guestWorkspaceId),
          ctx.db.get(share.ownerWorkspaceId),
          ctx.db.get(share.invitedBy)
        ])
        if (!channel || !owner) continue
        rows.push({
          _id: share._id,
          channelId: share.channelId,
          channelName: channel.name,
          guestWorkspaceId: share.guestWorkspaceId,
          guestWorkspaceName: guest?.name ?? 'your workspace',
          ownerWorkspaceName: owner.name,
          inviterName: inviter?.name ?? 'Someone',
          createdAt: share.createdAt
        })
      }
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  }
})

/** Count of pending channel-share invites for the caller's owned workspaces (badge). */
export const pendingCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const user = await getCurrentUser(ctx)
    if (!user) return 0
    const ownedWorkspaceIds = (await getMemberships(ctx, user._id))
      .filter((m) => m.role === 'owner')
      .map((m) => m.workspaceId)
    let count = 0
    for (const wsId of ownedWorkspaceIds) {
      const pending = await ctx.db
        .query('channelShares')
        .withIndex('by_guest_status', (q) => q.eq('guestWorkspaceId', wsId).eq('status', 'pending'))
        .collect()
      count += pending.length
    }
    return count
  }
})

/** The guest workspace's OWNER accepts a pending share → its members get access. */
export const accept = mutation({
  args: { shareId: v.id('channelShares') },
  handler: async (ctx, { shareId }) => {
    const user = await requireUser(ctx)
    const share = await ctx.db.get(shareId)
    if (!share || share.status !== 'pending') {
      throw new ConvexError('This invitation is no longer valid')
    }
    const guest = await ctx.db.get(share.guestWorkspaceId)
    if (!guest) throw new ConvexError('That workspace no longer exists')
    // Only the guest workspace's owner may accept (you said: the other side's owner).
    if (guest.ownerId !== user._id) {
      throw new ConvexError('Only the workspace owner can accept a shared channel')
    }
    await ctx.db.patch(shareId, {
      status: 'accepted',
      acceptedBy: user._id,
      acceptedAt: Date.now()
    })
    const channel = await ctx.db.get(share.channelId)
    return { slug: guest.slug, channelId: share.channelId, channelName: channel?.name ?? '' }
  }
})

/** The guest owner declines → the pending share is removed. */
export const decline = mutation({
  args: { shareId: v.id('channelShares') },
  handler: async (ctx, { shareId }) => {
    const user = await requireUser(ctx)
    const share = await ctx.db.get(shareId)
    if (!share) return
    const guest = await ctx.db.get(share.guestWorkspaceId)
    if (!guest || guest.ownerId !== user._id) {
      throw new ConvexError('Only the workspace owner can decline')
    }
    await ctx.db.delete(shareId)
  }
})

/** Preview a channel-share invite from its emailed token — the `/connect/<token>`
 *  accept page. Reports whether the caller is the guest workspace's owner (who alone
 *  may accept). */
export const previewByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await getCurrentUser(ctx)
    const share = await ctx.db
      .query('channelShares')
      .withIndex('by_token', (q) => q.eq('token', token.trim()))
      .unique()
    if (!share) return { valid: false as const }
    const [channel, owner, guest] = await Promise.all([
      ctx.db.get(share.channelId),
      ctx.db.get(share.ownerWorkspaceId),
      ctx.db.get(share.guestWorkspaceId)
    ])
    if (!channel || !owner || !guest) return { valid: false as const }
    return {
      valid: true as const,
      status: share.status,
      channelName: channel.name,
      ownerWorkspaceName: owner.name,
      guestWorkspaceName: guest.name,
      guestWorkspaceSlug: guest.slug,
      isGuestOwner: user ? guest.ownerId === user._id : false
    }
  }
})

/** Accept a channel share via its emailed token. Guest workspace OWNER only.
 *  Idempotent if already accepted. */
export const acceptByToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx)
    const share = await ctx.db
      .query('channelShares')
      .withIndex('by_token', (q) => q.eq('token', token.trim()))
      .unique()
    if (!share) throw new ConvexError('This invitation is no longer valid')
    const guest = await ctx.db.get(share.guestWorkspaceId)
    if (!guest) throw new ConvexError('That workspace no longer exists')
    if (guest.ownerId !== user._id) {
      throw new ConvexError('Only the workspace owner can accept a shared channel')
    }
    if (share.status !== 'accepted') {
      await ctx.db.patch(share._id, {
        status: 'accepted',
        acceptedBy: user._id,
        acceptedAt: Date.now()
      })
    }
    const channel = await ctx.db.get(share.channelId)
    return { slug: guest.slug, channelId: share.channelId, channelName: channel?.name ?? '' }
  }
})

/** Decline a channel share via its emailed token. Guest workspace OWNER only. */
export const declineByToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx)
    const share = await ctx.db
      .query('channelShares')
      .withIndex('by_token', (q) => q.eq('token', token.trim()))
      .unique()
    if (!share) return
    const guest = await ctx.db.get(share.guestWorkspaceId)
    if (!guest || guest.ownerId !== user._id) {
      throw new ConvexError('Only the workspace owner can decline')
    }
    if (share.status === 'pending') await ctx.db.delete(share._id)
  }
})

/** The connected workspaces for a channel (owner-side management view). Owner/admin
 *  of the host workspace only. */
export const listForChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const channel = await ctx.db.get(channelId)
    if (!channel) return []
    if (!isManager(await getMembership(ctx, channel.workspaceId, user._id))) return []

    const shares = await ctx.db
      .query('channelShares')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .collect()
    const out = await Promise.all(
      shares.map(async (share) => {
        const guest = await ctx.db.get(share.guestWorkspaceId)
        return {
          _id: share._id,
          guestWorkspaceId: share.guestWorkspaceId,
          guestWorkspaceName: guest?.name ?? 'Unknown workspace',
          guestWorkspaceSlug: guest?.slug ?? '',
          status: share.status,
          createdAt: share.createdAt
        }
      })
    )
    return out.sort((a, b) => a.createdAt - b.createdAt)
  }
})

/** Connection status for a channel's HEADER — usable by any member with access
 *  (host or guest). Drives the "Connected" pill: whether it's shared, the connected
 *  workspace names, and whether the caller is viewing it as a guest. */
export const connection = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access) return null

    const shares = await ctx.db
      .query('channelShares')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .collect()
    const accepted = shares.filter((s) => s.status === 'accepted')
    const owner = await ctx.db.get(access.channel.workspaceId)
    const guestNames = (await Promise.all(accepted.map((s) => ctx.db.get(s.guestWorkspaceId)))).map(
      (w) => w?.name ?? 'a workspace'
    )

    return {
      isShared: accepted.length > 0,
      viaGuest: access.via === 'guest',
      ownerWorkspaceName: owner?.name ?? 'a workspace',
      /** All connected orgs (host first), for the pill's tooltip. */
      workspaces: [owner?.name ?? 'a workspace', ...guestNames],
      guestCount: accepted.length
    }
  }
})

/** Per-channel share counts for channels a workspace OWNS and has shared out —
 *  drives the sidebar "connected" glyph on those channel rows. Member-gated. */
export const sharedFromWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const shares = await ctx.db
      .query('channelShares')
      .withIndex('by_owner_workspace', (q) => q.eq('ownerWorkspaceId', workspaceId))
      .collect()
    const byChannel = new Map<string, { accepted: number; pending: number }>()
    for (const share of shares) {
      const entry = byChannel.get(share.channelId as string) ?? { accepted: 0, pending: 0 }
      if (share.status === 'accepted') entry.accepted++
      else entry.pending++
      byChannel.set(share.channelId as string, entry)
    }
    return [...byChannel.entries()].map(([channelId, counts]) => ({
      channelId: channelId as Id<'channels'>,
      ...counts
    }))
  }
})

/** The channels shared INTO a workspace (accepted), for the guest sidebar's "Shared
 *  with you" section — each with the host workspace's name for the org badge. */
export const listForWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const shares = await ctx.db
      .query('channelShares')
      .withIndex('by_guest_status', (q) =>
        q.eq('guestWorkspaceId', workspaceId).eq('status', 'accepted')
      )
      .collect()
    const out = await Promise.all(
      shares.map(async (share) => {
        const [channel, owner] = await Promise.all([
          ctx.db.get(share.channelId),
          ctx.db.get(share.ownerWorkspaceId)
        ])
        if (!channel) return null
        return {
          shareId: share._id,
          channelId: channel._id,
          name: channel.name,
          kind: channel.kind,
          topic: channel.topic,
          ownerWorkspaceName: owner?.name ?? 'another workspace',
          lastMessageAt: channel.lastMessageAt
        }
      })
    )
    return out.filter((c): c is NonNullable<typeof c> => c !== null)
  }
})

/** Leave a shared channel (the GUEST side). Owner/admin of the guest workspace only;
 *  its members lose access. The host keeps the channel + history. */
export const leave = mutation({
  args: { channelId: v.id('channels'), workspaceId: v.id('workspaces') },
  handler: async (ctx, { channelId, workspaceId }) => {
    const user = await requireUser(ctx)
    if (!isManager(await getMembership(ctx, workspaceId, user._id))) {
      throw new ConvexError('Only owners and admins can leave a shared channel')
    }
    const share = await ctx.db
      .query('channelShares')
      .withIndex('by_channel_guest', (q) =>
        q.eq('channelId', channelId).eq('guestWorkspaceId', workspaceId)
      )
      .unique()
    if (!share) return
    await ctx.db.delete(share._id)
    // Drop the guest workspace's per-channel read markers + notifications.
    await ctx.scheduler.runAfter(0, internal.cleanup.sharedChannelGuest, {
      channelId,
      workspaceId
    })
  }
})

/** Remove a guest workspace (the HOST/owner side). Owner/admin of the host only. */
export const removeGuest = mutation({
  args: { channelId: v.id('channels'), guestWorkspaceId: v.id('workspaces') },
  handler: async (ctx, { channelId, guestWorkspaceId }) => {
    const user = await requireUser(ctx)
    const channel = await ctx.db.get(channelId)
    if (!channel) return
    if (!isManager(await getMembership(ctx, channel.workspaceId, user._id))) {
      throw new ConvexError('Only owners and admins can remove a shared workspace')
    }
    const share = await ctx.db
      .query('channelShares')
      .withIndex('by_channel_guest', (q) =>
        q.eq('channelId', channelId).eq('guestWorkspaceId', guestWorkspaceId)
      )
      .unique()
    if (!share) return
    await ctx.db.delete(share._id)
    await ctx.scheduler.runAfter(0, internal.cleanup.sharedChannelGuest, {
      channelId,
      workspaceId: guestWorkspaceId
    })
  }
})
