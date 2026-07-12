import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { getAcceptedGuestWorkspaceIds, getMembership } from './auth'

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
  const re = /zinx:\/\/user\/([A-Za-z0-9_]+)/g
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
      return { workspaceId: ownerWorkspaceId, isAdmin: ownerMembership.role !== 'member' }
    }
    for (const guestWorkspaceId of guestWorkspaceIds) {
      if (await getMembership(ctx, guestWorkspaceId, userId as Id<'users'>)) {
        return { workspaceId: guestWorkspaceId, isAdmin: false }
      }
    }
    return null
  }

  const add = async (userId: string, kind: Kind): Promise<void> => {
    if (userId === (actorId as string) || recipients.has(userId)) return
    const info = await resolve(userId)
    if (info) recipients.set(userId, { kind, workspaceId: info.workspaceId })
  }

  // Direct @user mentions (bounded by the number of distinct mentions in the body).
  for (const id of directIds) await add(id, 'mention')

  // @everyone / @admins are the ONLY reason to read the whole roster — do it lazily,
  // only when a group mention is actually present (the overwhelmingly common case
  // skips this entirely). `@admins` is host-side only (guests never moderate).
  if (wantsEveryone || wantsAdmins) {
    const fanWorkspace = async (workspaceId: Id<'workspaces'>, isHost: boolean): Promise<void> => {
      const members = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .collect()
      for (const m of members) {
        const key = m.userId as string
        if (key === (actorId as string) || recipients.has(key)) continue
        const isAdmin = isHost && m.role !== 'member'
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
