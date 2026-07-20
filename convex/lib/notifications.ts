import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { getAcceptedGuestWorkspaceIds, getMembership } from './auth'
import { getDmParticipantIds } from './dms'
import { getChannelMemberIds, isChannelMember } from './channelMembers'

/** Ceiling on how many notification rows one `send` writes. An `@everyone` in a
 *  big workspace would otherwise fan out to every member on the hottest mutation
 *  we have. Past this we drop the tail — the message is still in the channel and
 *  bolds it via unread, so nobody is silently cut off, they just don't get a
 *  discrete inbox row. Discord caps large-mention notifications too. */
const MAX_FANOUT = 100

type Kind = Doc<'notifications'>['kind']

/** Every `zinx://user/<id>` id in the body. The renderer stores mentions as links
 *  with a private scheme (see `lib/mention.ts`); this is the server-side reader,
 *  the same format `mentionsUser` sniffs. Ids that aren't real member ids are
 *  filtered out downstream (a hand-crafted body can't notify a stranger). */
function mentionedUserIds(body: string): string[] {
  const ids = new Set<string>()
  // Same id charset as `lib/mention.ts` HREF_RE (includes `-`), so the fan-out and
  // `mentionsUser` agree on exactly which ids a body mentions.
  const re = /zinx:\/\/user\/([A-Za-z0-9_-]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) ids.add(match[1])
  return [...ids]
}

/** Fan a freshly-sent message out to everyone it concerns, one row each.
 *
 *  Priority is mention > reply > thread: a message that @-mentions you *and*
 *  replies to you is a single `mention` row, so the Inbox never double-counts.
 *  The actor is never a recipient. Called from `messages.send` after the insert;
 *  all reads here are bounded (members of one workspace, one reply target, one
 *  thread's participants).
 *
 *  `replyTarget` is the message being replied to (already fetched + validated by
 *  `send`), passed in so we don't re-read it. */
export async function fanOutNotifications(
  ctx: MutationCtx,
  args: {
    message: Doc<'messages'>
    channel: Doc<'channels'>
    actorId: Id<'users'>
    replyTarget: Doc<'messages'> | null
    thread: Doc<'threads'> | null
  }
): Promise<void> {
  const { message, channel, actorId, replyTarget, thread } = args
  const ownerWorkspaceId = channel.workspaceId

  // A DM is addressed to its participants by definition, so EVERY message in one is
  // a notification — no @ needed (Slack and Discord both badge a DM on any message).
  // The audience is the `dmMembers` rows, never the workspace roster: `@everyone`
  // inside a DM must not escape it, and a mention of a non-participant must not
  // reach them. Bounded by `MAX_DM_MEMBERS`.
  if (channel.kind === 'dm') {
    for (const userId of await getDmParticipantIds(ctx, channel._id)) {
      if (userId === actorId) continue
      await ctx.db.insert('notifications', {
        userId,
        workspaceId: channel.workspaceId,
        channelId: channel._id,
        messageId: message._id,
        actorId,
        kind: 'dm',
        createdAt: message.createdAt
      })
    }
    return
  }

  const body = message.body
  const wantsEveryone = body.includes('zinx://group/everyone')
  const wantsAdmins = body.includes('zinx://group/admins')
  const directIds = mentionedUserIds(body)

  // The channel's guest workspaces (bounded by MAX_SHARE_GUESTS) — the audience is
  // the host's members + each accepted guest's members. Each recipient is tagged with
  // the workspace they access the channel THROUGH, so the notification lands in their
  // own Inbox (host members → host workspace; guest members → their guest workspace).
  const guestWorkspaceIds = await getAcceptedGuestWorkspaceIds(ctx, channel._id)

  // Strongest kind wins; first write for a user sticks. A recipient must be in the
  // audience — a crafted body can't notify a stranger; a mention of someone who left
  // is dropped.
  const recipients = new Map<string, { kind: Kind; workspaceId: Id<'workspaces'> }>()

  // Resolve a single candidate to their access workspace (+ host-admin flag), or null
  // if they aren't in the audience. Bounded: one indexed membership read for the host,
  // plus at most one per guest workspace. This is the common path — a message with a
  // couple of direct @mentions costs a couple of reads, NOT a scan of every member.
  const resolve = async (
    userId: string
  ): Promise<{ workspaceId: Id<'workspaces'>; isAdmin: boolean } | null> => {
    const ownerMembership = await getMembership(ctx, ownerWorkspaceId, userId as Id<'users'>)
    if (ownerMembership) {
      return {
        workspaceId: ownerWorkspaceId,
        // NOT `!== 'member'` — that would make a GUEST an admin, so `@admins` would ping
        // every guest in the workspace.
        isAdmin: ownerMembership.role === 'owner' || ownerMembership.role === 'admin'
      }
    }
    for (const guestWorkspaceId of guestWorkspaceIds) {
      if (await getMembership(ctx, guestWorkspaceId, userId as Id<'users'>)) {
        return { workspaceId: guestWorkspaceId, isAdmin: false }
      }
    }
    return null
  }

  // In a PRIVATE channel, the audience is the channel's members — not the workspace's.
  // Without this, @-mentioning someone who isn't in the channel would send them an inbox
  // row for a message they can't open: a notification that leaks the existence (and, via
  // the preview, the *content*) of a conversation they've been kept out of.
  const isPrivate = channel.visibility === 'private'

  const add = async (userId: string, kind: Kind): Promise<void> => {
    if (userId === (actorId as string) || recipients.has(userId)) return
    const info = await resolve(userId)
    if (!info) return
    if (isPrivate && !(await isChannelMember(ctx, channel._id, userId as Id<'users'>))) return
    recipients.set(userId, { kind, workspaceId: info.workspaceId })
  }

  // Direct @user mentions (bounded by the number of distinct mentions in the body).
  for (const id of directIds) await add(id, 'mention')

  // @everyone / @admins are the ONLY reason to read the whole roster — do it lazily,
  // only when a group mention is actually present (the overwhelmingly common case
  // skips this entirely). `@admins` is host-side only (guests never moderate).
  // `@everyone` in a private channel is everyone in the ROOM, not in the workspace. Reading
  // the roster here and filtering afterwards would work too, but this reads only the rows
  // it can actually notify.
  if (isPrivate && (wantsEveryone || wantsAdmins)) {
    for (const memberId of await getChannelMemberIds(ctx, channel._id)) {
      const key = memberId as string
      if (key === (actorId as string) || recipients.has(key)) continue
      const info = await resolve(key)
      if (!info) continue
      // `@admins` inside a private channel pings the admins who are IN it.
      if (wantsEveryone || (wantsAdmins && info.isAdmin)) {
        recipients.set(key, { kind: 'mention', workspaceId: info.workspaceId })
      }
    }
  } else if (wantsEveryone || wantsAdmins) {
    const fanWorkspace = async (workspaceId: Id<'workspaces'>, isHost: boolean): Promise<void> => {
      // `@admins` reads only the two moderator roles — a handful of rows, not the
      // roster. `@everyone` reads the roster, but stops at the number of rows it could
      // possibly write: we cap the fan-out at MAX_FANOUT, so reading a 5,000-member
      // workspace to write 100 notifications was pure waste.
      const members = wantsEveryone
        ? await ctx.db
            .query('workspaceMembers')
            .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
            .take(MAX_FANOUT)
        : (
            await Promise.all(
              (['owner', 'admin'] as const).map((role) =>
                ctx.db
                  .query('workspaceMembers')
                  .withIndex('by_workspace_role', (q) =>
                    q.eq('workspaceId', workspaceId).eq('role', role)
                  )
                  .take(MAX_FANOUT)
              )
            )
          ).flat()
      for (const m of members) {
        const key = m.userId as string
        if (key === (actorId as string) || recipients.has(key)) continue
        const isAdmin = isHost && (m.role === 'owner' || m.role === 'admin')
        if (wantsEveryone || (wantsAdmins && isAdmin)) {
          recipients.set(key, { kind: 'mention', workspaceId })
        }
      }
    }
    await fanWorkspace(ownerWorkspaceId, true)
    // Guests are pinged only by @everyone (never @admins — they hold no host role).
    if (wantsEveryone) {
      for (const guestWorkspaceId of guestWorkspaceIds) await fanWorkspace(guestWorkspaceId, false)
    }
  }

  // A reply to your message pings you (unless a stronger mention row already exists).
  if (replyTarget) await add(replyTarget.authorId as string, 'reply')

  // A thread reply pings the thread's other participants.
  if (thread) {
    for (const participantId of thread.participantIds) await add(participantId as string, 'thread')
  }

  let written = 0
  for (const [userId, { kind, workspaceId }] of recipients) {
    if (written >= MAX_FANOUT) break
    await ctx.db.insert('notifications', {
      userId: userId as Id<'users'>,
      workspaceId,
      channelId: channel._id,
      messageId: message._id,
      actorId,
      kind,
      threadId: message.threadId,
      createdAt: message.createdAt
    })
    written++
  }
}

/** Delete every notification pointing at a message (its author deleted it, or a
 *  cascade removed it). Bounded: a message has at most `MAX_FANOUT` of them. */
export async function removeNotificationsForMessage(
  ctx: MutationCtx,
  messageId: Id<'messages'>
): Promise<void> {
  const rows = await ctx.db
    .query('notifications')
    .withIndex('by_message', (q) => q.eq('messageId', messageId))
    .collect()
  for (const row of rows) await ctx.db.delete(row._id)
}
