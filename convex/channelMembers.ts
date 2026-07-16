import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { getChannelAccess, getCurrentUser, getMembership, requireUser } from './lib/auth'
import { isChannelMember } from './lib/channelMembers'
import { resolveAuthors } from './lib/messages'

/**
 * Membership of a **private** channel (and, for a guest, of any channel).
 *
 * Slack's model: access to content is decided by who is in the room, not by what role you
 * hold. See `lib/auth.ts` `getChannelAccess` — this file just maintains the rows it reads.
 */

/** A private channel is a room, not a broadcast. Past this it wants to be public. */
const MAX_CHANNEL_MEMBERS = 500

/** You must be able to SEE a channel to manage its membership — which for a private
 *  channel means being in it. An admin who isn't a member has no say over it, exactly as
 *  they have no sight of it. (The workspace owner's one power is deleting it; see
 *  `channels.remove`.) */
async function requireChannelMembershipRights(
  ctx: Parameters<typeof getChannelAccess>[0],
  channelId: Id<'channels'>,
  userId: Id<'users'>
) {
  const access = await getChannelAccess(ctx, channelId, userId)
  if (!access) throw new ConvexError('Channel not found')
  if (access.channel.kind === 'dm') {
    throw new ConvexError("That's a direct message — use the conversation itself")
  }
  if (access.via !== 'owner') {
    throw new ConvexError('Only the host workspace can manage this channel')
  }
  // A guest may not add people, even to a channel they're in.
  if (access.membership?.role === 'guest') {
    throw new ConvexError('Guests cannot manage channel members')
  }
  return access
}

/**
 * Does deleting this person's row take their ACCESS with it, or only their posting rights?
 *
 * In a private channel (or for a guest, for whom every channel behaves as private) the row
 * IS the access — so their unread + inbox rows for the channel must go too, or they'd keep
 * being notified about a conversation they can no longer open. In a **public** channel the
 * row only ever meant "may post"; the person still reads the channel, so purging their
 * history would be destructive and wrong.
 */
async function removalRevokesAccess(
  ctx: Parameters<typeof getMembership>[0],
  channel: Doc<'channels'>,
  userId: Id<'users'>
): Promise<boolean> {
  if (channel.visibility === 'private') return true
  const membership = await getMembership(ctx, channel.workspaceId, userId)
  return membership?.role === 'guest'
}

/** The channel's members. For a **public** channel this is still meaningful — it's who has
 *  been explicitly added (a guest, say) — but the sidebar only surfaces it for private
 *  channels, where it IS the access list. */
export const listByChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    // Null-safe: no access → no member list. (You can't enumerate the members of a private
    // channel you're not in — that would leak who's talking to whom.)
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access) return []

    const rows = await ctx.db
      .query('channelMembers')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(MAX_CHANNEL_MEMBERS)

    const people = await resolveAuthors(
      ctx,
      access.channel.workspaceId,
      rows.map((row) => row.userId)
    )
    const memberships = await Promise.all(
      rows.map((row) => getMembership(ctx, access.channel.workspaceId, row.userId))
    )

    return rows.map((row, index) => {
      const person = people.get(row.userId)
      return {
        userId: row.userId,
        name: person?.name ?? 'Unknown',
        color: person?.color,
        avatarUrl: person?.avatarUrl,
        presence: person?.presence,
        statusEmoji: person?.statusEmoji,
        statusText: person?.statusText,
        role: memberships[index]?.role ?? 'member',
        // Only meaningful while `postingPolicy === 'selected'` — the panel shows a
        // Can post / View only toggle then, and nothing otherwise.
        canPost: row.canPost !== false,
        addedBy: row.addedBy,
        addedAt: row.addedAt
      }
    })
  }
})

/** Add people to a channel. Idempotent per user — adding someone twice is a no-op, not an
 *  error, because the UI multi-selects and a double-click shouldn't fail the whole call. */
export const add = mutation({
  args: {
    channelId: v.id('channels'),
    userIds: v.array(v.id('users')),
    /** Only consulted while the channel's `postingPolicy` is `'selected'`. Absent = they
     *  may post — adding someone as a *viewer* is the deliberate act, not the default. */
    canPost: v.optional(v.boolean())
  },
  handler: async (ctx, { channelId, userIds, canPost }) => {
    const user = await requireUser(ctx)
    const access = await requireChannelMembershipRights(ctx, channelId, user._id)
    const workspaceId = access.channel.workspaceId

    const existing = await ctx.db
      .query('channelMembers')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(MAX_CHANNEL_MEMBERS)
    if (existing.length + userIds.length > MAX_CHANNEL_MEMBERS) {
      throw new ConvexError(`A channel can have at most ${MAX_CHANNEL_MEMBERS} members`)
    }
    const already = new Set(existing.map((row) => row.userId as string))

    const now = Date.now()
    for (const userId of new Set(userIds)) {
      if (already.has(userId as string)) continue
      // Every added person must be a member of the HOST workspace — otherwise a crafted id
      // could pull a stranger into a private channel. (Same guard `dms.open` applies.)
      if (!(await getMembership(ctx, workspaceId, userId))) {
        throw new ConvexError('That person is not in this workspace')
      }
      await ctx.db.insert('channelMembers', {
        channelId,
        workspaceId,
        userId,
        addedBy: user._id,
        addedAt: now,
        ...(canPost === false ? { canPost: false } : {})
      })
    }
  }
})

/** Remove someone from a channel — and take their unread + inbox rows for it with them, or
 *  they'd keep getting notifications for a channel they can no longer open. */
export const remove = mutation({
  args: { channelId: v.id('channels'), userId: v.id('users') },
  handler: async (ctx, { channelId, userId }) => {
    const user = await requireUser(ctx)
    const access = await requireChannelMembershipRights(ctx, channelId, user._id)

    const row = await ctx.db
      .query('channelMembers')
      .withIndex('by_channel_user', (q) => q.eq('channelId', channelId).eq('userId', userId))
      .unique()
    if (!row) return

    await ctx.db.delete(row._id)
    if (await removalRevokesAccess(ctx, access.channel, userId)) {
      await ctx.scheduler.runAfter(0, internal.cleanup.channelMember, {
        channelId,
        userId,
        workspaceId: access.channel.workspaceId
      })
    }
  }
})

/** Leave a channel yourself. Separate from `remove` on purpose: it needs no management
 *  rights (a guest can leave), and it's the one case where losing your own access is fine. */
export const leave = mutation({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await requireUser(ctx)
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access || access.via !== 'owner') throw new ConvexError('Channel not found')
    if (access.channel.isDefault) {
      throw new ConvexError("You can't leave the workspace's default channel")
    }
    if (!(await isChannelMember(ctx, channelId, user._id))) return

    const row = await ctx.db
      .query('channelMembers')
      .withIndex('by_channel_user', (q) => q.eq('channelId', channelId).eq('userId', user._id))
      .unique()
    if (!row) return
    await ctx.db.delete(row._id)
    if (await removalRevokesAccess(ctx, access.channel, user._id)) {
      await ctx.scheduler.runAfter(0, internal.cleanup.channelMember, {
        channelId,
        userId: user._id,
        workspaceId: access.channel.workspaceId
      })
    }
  }
})

/**
 * Convert a channel between public and private.
 *
 * **public → private** keeps the history and seeds the member list with whoever is
 * converting (plus anyone already explicitly added). Everyone else loses access
 * immediately — which is the point, but it means the caller had better mean it.
 *
 * **private → public** exposes the whole history to the workspace. The UI warns; the
 * server just does it, because there's no safe partial version of this.
 */
export const setVisibility = mutation({
  args: {
    channelId: v.id('channels'),
    visibility: v.union(v.literal('public'), v.literal('private'))
  },
  handler: async (ctx, { channelId, visibility }) => {
    const user = await requireUser(ctx)
    const access = await requireChannelMembershipRights(ctx, channelId, user._id)
    if (!access.canModerate) {
      throw new ConvexError('Only owners and admins can change who can see a channel')
    }
    if (access.channel.isDefault && visibility === 'private') {
      throw new ConvexError("The workspace's default channel can't be made private")
    }
    if ((access.channel.visibility ?? 'public') === visibility) return

    await ctx.db.patch(channelId, { visibility })

    // Going private: make sure the room isn't empty. Without this the converter would lock
    // themselves out of the channel they just converted — and with nobody in it, only the
    // workspace owner could even delete it.
    if (visibility === 'private' && !(await isChannelMember(ctx, channelId, user._id))) {
      await ctx.db.insert('channelMembers', {
        channelId,
        workspaceId: access.channel.workspaceId,
        userId: user._id,
        addedBy: user._id,
        addedAt: Date.now()
      })
    }
  }
})

/**
 * Who may post here. **Read access is unaffected by all three** — a read-only channel is
 * still fully visible, which is the whole difference between this and `private`.
 *
 *  - `everyone` — anyone who can see the channel can talk in it. The default.
 *  - `admins`   — an announcement channel: owner/admins write, everyone else reads.
 *  - `selected` — **named people talk, everyone else views.** The talkers are the
 *    `channelMembers` rows whose `canPost` isn't false, which is precisely why posting
 *    rights live on a row and not on a role: two people of the same rank, in the same
 *    channel, can differ. No role ladder can say that.
 *
 * Switching TO `selected` leaves whoever is already listed able to post and mutes the rest
 * of the workspace. If nobody is listed yet, it behaves as `admins` until you add someone —
 * which is the safe direction to fail, and what the UI prompts you to fix.
 */
export const setPostingPolicy = mutation({
  args: {
    channelId: v.id('channels'),
    postingPolicy: v.union(v.literal('everyone'), v.literal('admins'), v.literal('selected'))
  },
  handler: async (ctx, { channelId, postingPolicy }) => {
    const user = await requireUser(ctx)
    const access = await requireChannelMembershipRights(ctx, channelId, user._id)
    if (!access.canModerate) {
      throw new ConvexError('Only owners and admins can change who can post')
    }
    await ctx.db.patch(channelId, { postingPolicy })
  }
})

/**
 * Grant or revoke one person's right to talk in a `selected` channel.
 *
 * **Upserts**, because the row means two different things depending on the channel: in a
 * private one it's their access (so revoking must keep it, with `canPost: false` — muting
 * someone is not the same as throwing them out), and in a public one it exists only to say
 * "this person may talk", so granting has to be able to create it.
 */
export const setCanPost = mutation({
  args: { channelId: v.id('channels'), userId: v.id('users'), canPost: v.boolean() },
  handler: async (ctx, { channelId, userId, canPost }) => {
    const user = await requireUser(ctx)
    const access = await requireChannelMembershipRights(ctx, channelId, user._id)
    if (!access.canModerate) {
      throw new ConvexError('Only owners and admins can change who can post')
    }
    const workspaceId = access.channel.workspaceId
    if (!(await getMembership(ctx, workspaceId, userId))) {
      throw new ConvexError('That person is not in this workspace')
    }

    const row = await ctx.db
      .query('channelMembers')
      .withIndex('by_channel_user', (q) => q.eq('channelId', channelId).eq('userId', userId))
      .unique()

    if (row) {
      await ctx.db.patch(row._id, { canPost })
      return
    }
    // No row yet — a public channel. Revoking is already the state, so there's nothing to
    // write; granting needs the row.
    if (!canPost) return
    const existing = await ctx.db
      .query('channelMembers')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .take(MAX_CHANNEL_MEMBERS)
    if (existing.length >= MAX_CHANNEL_MEMBERS) {
      throw new ConvexError(`A channel can have at most ${MAX_CHANNEL_MEMBERS} members`)
    }
    await ctx.db.insert('channelMembers', {
      channelId,
      workspaceId,
      userId,
      addedBy: user._id,
      addedAt: Date.now(),
      canPost: true
    })
  }
})
