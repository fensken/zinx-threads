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
  /** `dm` = a direct message the caller is a participant of. Membership comes from
   *  `dmMembers`, NOT from the workspace — being in the workspace grants nothing. */
  via: 'owner' | 'guest' | 'dm'
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
  /** Whether the caller may WRITE here — reading and writing are different questions.
   *  False in an announcement channel (`postingPolicy: 'admins'`) for anyone who isn't an
   *  owner/admin of the host workspace. Computed here rather than at each call site, so a
   *  new write path can't forget to check it (which is exactly how `_zinx` ended up with
   *  three copies of its rank comparison). */
  canPost: boolean
  /** The earliest message `createdAt` the caller may see. `0` for an owner (full
   *  history); a guest's share `acceptedAt` on the guest path, so a workspace
   *  invited into a channel sees only messages posted after it joined — never the
   *  history that predates the connection (Slack Connect behaviour). */
  since: number
}

/**
 * May this person post here? The single definition of the rule — every write path reads it
 * off `ChannelAccess.canPost` rather than re-deriving it, which is exactly how `_zinx`
 * ended up with three copies of its rank comparison that could drift apart.
 *
 * `membership` is the caller's `channelMembers` row, if one was fetched (it is whenever
 * the answer could depend on it).
 */
export function canPostIn(
  channel: Doc<'channels'>,
  isModerator: boolean,
  membership: Doc<'channelMembers'> | null
): boolean {
  // Owner/admins always can — they can change the policy in one click.
  if (isModerator) return true
  switch (channel.postingPolicy) {
    case 'admins':
      return false
    case 'selected':
      // Named as a talker. No row (or an explicit `canPost: false`) → read-only.
      return membership?.canPost !== false && membership !== null
    default:
      return true
  }
}

/** The caller's access to a channel, or null if they have none (owner OR guest). */
export async function getChannelAccess(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<'channels'>,
  userId: Id<'users'>
): Promise<ChannelAccess | null> {
  const channel = await ctx.db.get(channelId)
  if (!channel) return null

  // A DM is a channel, but workspace membership does NOT open it — checked FIRST so
  // the owner branch below can never hand a workspace member someone else's DM.
  // Nobody moderates a DM: `canModerate: false` leaves delete/edit author-only and
  // pinning off, which is what Slack and Discord both do.
  if (channel.kind === 'dm') {
    const participant = await ctx.db
      .query('dmMembers')
      .withIndex('by_channel_user', (q) => q.eq('channelId', channelId).eq('userId', userId))
      .unique()
    if (!participant) return null
    return {
      channel,
      via: 'dm',
      workspaceId: channel.workspaceId,
      accessWorkspaceId: channel.workspaceId,
      membership: await getMembership(ctx, channel.workspaceId, userId),
      canModerate: false,
      // Nobody moderates a DM, but everyone in one may post in it.
      canPost: true,
      since: 0
    }
  }

  const ownerMembership = await getMembership(ctx, channel.workspaceId, userId)
  if (ownerMembership) {
    // **Membership decides content access, not role.** Two cases need an explicit
    // `channelMembers` row, and they collapse into one condition:
    //
    //  - the channel is PRIVATE — including for an admin. An admin who isn't in a private
    //    channel gets *nothing*: they can't read it, can't post, can't see it in the
    //    sidebar or search. That's Slack's rule, and it's the entire point of the feature
    //    (a channel a moderator can silently read is not private). The workspace **owner**
    //    keeps exactly one power over it — `channels.remove` — so a channel whose last
    //    member left can't become unreachable *and* undeletable. They still can't read it.
    //
    //  - the caller is a GUEST — for whom *every* channel behaves as if it were private.
    //    That's why guests needed no machinery of their own.
    //
    // Note this is checked with the SAME index (`by_channel_user`) that gates DMs, and for
    // the same reason: "is this person in this room" is the only question worth asking.
    const needsChannelMembership =
      channel.visibility === 'private' || ownerMembership.role === 'guest'

    // We also need the row when posting is restricted to *specific people*, because that's
    // where their `canPost` lives. One read either way — the same `by_channel_user` lookup.
    const restrictedPosting = channel.postingPolicy === 'selected'
    const inChannel =
      needsChannelMembership || restrictedPosting
        ? await ctx.db
            .query('channelMembers')
            .withIndex('by_channel_user', (q) => q.eq('channelId', channelId).eq('userId', userId))
            .unique()
        : null

    if (needsChannelMembership && !inChannel) return null

    const isModerator = ownerMembership.role === 'owner' || ownerMembership.role === 'admin'
    return {
      channel,
      via: 'owner',
      workspaceId: channel.workspaceId,
      accessWorkspaceId: channel.workspaceId,
      membership: ownerMembership,
      // A guest never moderates, whatever else is true of the channel.
      canModerate: isModerator,
      // **Reading and writing are different questions.** A channel can be fully visible and
      // still read-only for you:
      //   • `admins`   → an announcement channel: everyone reads, owner/admins write.
      //   • `selected` → specific people talk, everyone else views. The talkers are the
      //     `channelMembers` rows whose `canPost` isn't false — so two members of the same
      //     private channel can differ, which is exactly why this lives on the row and not
      //     on a role.
      // Owner/admins can always post: they can flip the policy in one click, so locking
      // them out would be theatre, not security.
      canPost: canPostIn(channel, isModerator, inChannel),
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
    // A guest WORKSPACE (Slack Connect) can post only when the channel is open to
    // everyone: it has no `channelMembers` rows in the host workspace, so both `admins`
    // and `selected` leave it read-only.
    canPost: (channel.postingPolicy ?? 'everyone') === 'everyone',
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
