import type { QueryCtx, MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

/** Mirrors `dms.ts` — a person's DM list is bounded by who they've talked to. */
const MAX_DMS = 200

/** The DM channels a user participates in, inside one workspace.
 *
 *  Every surface that enumerates a workspace's channels has to fold these in
 *  (unread, search) — and, critically, must NOT reach them by listing the
 *  workspace's channels, which would hand the caller everyone else's DMs. Going
 *  through `dmMembers` means the caller's own conversations are all they can ever
 *  see, by construction. */
export async function getMyDmChannels(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'workspaces'>,
  userId: Id<'users'>
): Promise<Doc<'channels'>[]> {
  const rows = await ctx.db
    .query('dmMembers')
    .withIndex('by_user_workspace', (q) => q.eq('userId', userId).eq('workspaceId', workspaceId))
    .take(MAX_DMS)
  const channels = await Promise.all(rows.map((row) => ctx.db.get(row.channelId)))
  return channels.filter((c): c is Doc<'channels'> => c !== null)
}

/** Everyone in a DM (bounded by `MAX_DM_MEMBERS`) — the notification fan-out's
 *  audience, and the header's participant list. */
export async function getDmParticipantIds(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<'channels'>
): Promise<Id<'users'>[]> {
  const rows = await ctx.db
    .query('dmMembers')
    .withIndex('by_channel', (q) => q.eq('channelId', channelId))
    .collect()
  return rows.map((row) => row.userId)
}
