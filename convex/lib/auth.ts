import { ConvexError } from 'convex/values'
import type { UserIdentity } from 'convex/server'
import type { ActionCtx, QueryCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

// Resolve the caller (from the WorkOS-issued JWT that convex/auth.config.ts
// trusts) to our own `users` row.
//
// Keyed on `identity.tokenIdentifier` (`${issuer}|${subject}`), which is Convex's
// canonical identity key. `identity.subject` alone is NOT safe as a global key —
// two issuers could mint the same subject — and the Convex guidelines say so
// explicitly. `users.externalId` still stores the raw subject for display/joins.

export async function getCurrentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null

  const byToken = await ctx.db
    .query('users')
    .withIndex('by_token_identifier', (q) => q.eq('tokenIdentifier', identity.tokenIdentifier))
    .unique()
  if (byToken) return byToken

  // Rows written before `tokenIdentifier` existed. `users.store` backfills the
  // field on the next sign-in, after which this branch stops being taken.
  return await ctx.db
    .query('users')
    .withIndex('by_external_id', (q) => q.eq('externalId', identity.subject))
    .unique()
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<'users'>> {
  const user = await getCurrentUser(ctx)
  if (!user) throw new ConvexError('Not authenticated')
  return user
}

/** Actions have no `ctx.db`, so they can't resolve a `users` row — but they can
 *  still check that the caller is signed in. Our actions proxy paid third-party
 *  APIs (KLIPY, Unsplash) with server-side keys; without this, anyone who can
 *  reach the deployment can burn the quota. */
export async function requireIdentity(ctx: ActionCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new ConvexError('Not authenticated')
  return identity
}

/** The caller's membership row in a workspace, or null if not a member. */
export async function getMembership(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'workspaces'>,
  userId: Id<'users'>
): Promise<Doc<'workspaceMembers'> | null> {
  return await ctx.db
    .query('workspaceMembers')
    .withIndex('by_workspace_user', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId))
    .unique()
}

/** Every workspace the user belongs to (bounded — a person is in few workspaces). */
export async function getMemberships(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>
): Promise<Doc<'workspaceMembers'>[]> {
  return await ctx.db
    .query('workspaceMembers')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()
}

/** The channels shared INTO a workspace and accepted — the guest side's extra
 *  channels, rendered in a "Shared with you" sidebar section. Bounded by the number
 *  of shares into the workspace. */
export async function getSharedChannelsInto(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'workspaces'>
): Promise<Doc<'channels'>[]> {
  const shares = await ctx.db
    .query('channelShares')
    .withIndex('by_guest_status', (q) =>
      q.eq('guestWorkspaceId', workspaceId).eq('status', 'accepted')
    )
    .collect()
  const channels = await Promise.all(shares.map((s) => ctx.db.get(s.channelId)))
  return channels.filter((c): c is Doc<'channels'> => c !== null)
}

/** The workspaces a channel is shared into and **accepted** (guest access is live).
 *  Bounded by `MAX_SHARE_GUESTS`. */
export async function getAcceptedGuestWorkspaceIds(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<'channels'>
): Promise<Id<'workspaces'>[]> {
  const shares = await ctx.db
    .query('channelShares')
    .withIndex('by_channel', (q) => q.eq('channelId', channelId))
    .collect()
  return shares.filter((s) => s.status === 'accepted').map((s) => s.guestWorkspaceId)
}

/** Resolved access to a channel — the single authorization primitive for a
 *  cross-workspace-shared channel. Access is either **owner** (a member of the
 *  channel's home workspace) or **guest** (a member of a workspace the channel is
 *  shared into + accepted). Only owner-side owner/admins moderate — the owner
 *  workspace is "in charge"; guests never do. */
export interface ChannelAccess {
  channel: Doc<'channels'>
  via: 'owner' | 'guest'
  /** The channel's HOME (owner) workspace — always `channel.workspaceId`. Used to
   *  key messages/threads and to enumerate the owner-side member set. */
  workspaceId: Id<'workspaces'>
  /** The workspace the caller **views the channel through** — the home workspace on
   *  the owner path, or the matched guest workspace on the guest path. This is the
   *  key for the caller's `channelReads` + inbox notifications, so a shared channel's
   *  unread/mentions land in the sidebar the caller actually sees it in. */
  accessWorkspaceId: Id<'workspaces'>
  /** The caller's owner-side membership (present only on the owner path). */
  membership: Doc<'workspaceMembers'> | null
  /** True only for an owner-workspace owner/admin. Guests are never moderators. */
  canModerate: boolean
  /** The earliest message `createdAt` the caller may see. `0` for an owner (full
   *  history); a guest's share `acceptedAt` on the guest path, so a workspace
   *  invited into a channel sees only messages posted after it joined — never the
   *  history that predates the connection (Slack Connect behaviour). */
  since: number
}

/** The caller's access to a channel, or null if they have none (owner OR guest). */
export async function getChannelAccess(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<'channels'>,
  userId: Id<'users'>
): Promise<ChannelAccess | null> {
  const channel = await ctx.db.get(channelId)
  if (!channel) return null

  const ownerMembership = await getMembership(ctx, channel.workspaceId, userId)
  if (ownerMembership) {
    return {
      channel,
      via: 'owner',
      workspaceId: channel.workspaceId,
      accessWorkspaceId: channel.workspaceId,
      membership: ownerMembership,
      canModerate: ownerMembership.role === 'owner' || ownerMembership.role === 'admin',
      since: 0
    }
  }

  // Guest path: the caller is a member of a workspace this channel is shared into.
  // We need the matched share (not just the id) for its `acceptedAt` cut-off.
  const shares = await ctx.db
    .query('channelShares')
    .withIndex('by_channel', (q) => q.eq('channelId', channelId))
    .collect()
  const accepted = shares.filter((s) => s.status === 'accepted')
  if (accepted.length === 0) return null
  const mine = new Set((await getMemberships(ctx, userId)).map((m) => m.workspaceId as string))
  const matchedShare = accepted.find((s) => mine.has(s.guestWorkspaceId as string))
  if (!matchedShare) return null

  return {
    channel,
    via: 'guest',
    workspaceId: channel.workspaceId,
    accessWorkspaceId: matchedShare.guestWorkspaceId,
    membership: null,
    canModerate: false,
    // Only messages from the moment this workspace joined. Fall back to the share's
    // creation time if an older accepted row somehow lacks `acceptedAt`.
    since: matchedShare.acceptedAt ?? matchedShare.createdAt
  }
}

/** Like `getChannelAccess` but throws when the caller has no access. */
export async function requireChannelAccess(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<'channels'>,
  userId: Id<'users'>
): Promise<ChannelAccess> {
  const access = await getChannelAccess(ctx, channelId, userId)
  if (!access) throw new ConvexError('You do not have access to this channel')
  return access
}
