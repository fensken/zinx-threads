import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

/**
 * Private-channel membership — the mirror of `lib/dms.ts`, and for the same reason.
 *
 * Every surface that enumerates a workspace's channels has to fold this in (the sidebar,
 * unread, search, the `#`-autocomplete, the ⌘K palette, the threads flyout) — and,
 * critically, must NOT reach a private channel by listing the workspace's channels, which
 * would hand the caller channels they aren't in. Going through `channelMembers` means the
 * caller's own channels are all they can ever get, **by construction**.
 *
 * This is the exact lesson the DM work taught: the leak is never in the gate, it's in the
 * dozen places that enumerate.
 */

/** A person is in few private channels; a workspace has few channels. Bounded either way. */
const MAX_CHANNEL_MEMBERSHIPS = 500

/** The channels a user has a `channelMembers` row in, keyed by channel id.
 *
 *  A **Map**, not a Set, because the row carries `canPost` as well as access — and the
 *  sidebar needs both in one read: which channels you can see, and which of them you can
 *  talk in. */
export type MyChannels = Map<string, Doc<'channelMembers'>>

/** The private channels (and, for a guest, ALL channels) a user is in, in one workspace. */
export async function getMyChannelIds(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'workspaces'>,
  userId: Id<'users'>
): Promise<MyChannels> {
  const rows = await ctx.db
    .query('channelMembers')
    .withIndex('by_user_workspace', (q) => q.eq('userId', userId).eq('workspaceId', workspaceId))
    .take(MAX_CHANNEL_MEMBERSHIPS)
  return new Map(rows.map((row) => [row.channelId as string, row]))
}

/**
 * Filter a list of channels down to what this caller may SEE.
 *
 * The one rule, in one place:
 *  - a **guest** sees only channels they're explicitly in — every channel behaves as
 *    private for them;
 *  - everyone else sees public channels, plus the private ones they're in.
 *
 * `role` is the caller's workspace role. Pass the channels you already read (this filters,
 * it doesn't fetch) — the set of channels in a workspace is small and bounded, unlike DMs,
 * so reading a private channel doc and dropping it is fine.
 */
export function visibleChannels<T extends Doc<'channels'>>(
  channels: T[],
  role: Doc<'workspaceMembers'>['role'],
  myChannelIds: MyChannels
): T[] {
  if (role === 'guest') {
    return channels.filter((channel) => myChannelIds.has(channel._id as string))
  }
  return channels.filter(
    (channel) => channel.visibility !== 'private' || myChannelIds.has(channel._id as string)
  )
}

/** Everyone in a channel (bounded) — the member list, and the notification fan-out's
 *  audience when the channel is private. */
export async function getChannelMemberIds(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<'channels'>
): Promise<Id<'users'>[]> {
  const rows = await ctx.db
    .query('channelMembers')
    .withIndex('by_channel', (q) => q.eq('channelId', channelId))
    .take(MAX_CHANNEL_MEMBERSHIPS)
  return rows.map((row) => row.userId)
}

/** Is this person in this channel? The same question, and the same index, that gates a DM. */
export async function isChannelMember(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<'channels'>,
  userId: Id<'users'>
): Promise<boolean> {
  const row = await ctx.db
    .query('channelMembers')
    .withIndex('by_channel_user', (q) => q.eq('channelId', channelId).eq('userId', userId))
    .unique()
  return row !== null
}
