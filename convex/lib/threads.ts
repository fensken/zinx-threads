import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/** How many participants the thread row remembers. Only the first few are ever
 *  drawn (the indicator shows 3), and the array must stay bounded. */
export const THREAD_PARTICIPANT_CAP = 10

/** Bookkeeping after a reply lands in a thread: bump the counters the channel's
 *  thread indicator reads, and record the replier as a participant.
 *
 *  Lives here rather than in `threads.ts` because `messages.send` owns the insert
 *  — a thread reply *is* a message, and splitting the write across two mutations
 *  would let the counters drift.  */
export async function addThreadReply(
  ctx: MutationCtx,
  threadId: Id<'threads'>,
  authorId: Id<'users'>
): Promise<void> {
  const thread = await ctx.db.get(threadId)
  if (!thread) return

  const participants = thread.participantIds.includes(authorId)
    ? thread.participantIds
    : [...thread.participantIds, authorId].slice(0, THREAD_PARTICIPANT_CAP)

  await ctx.db.patch(threadId, {
    replyCount: thread.replyCount + 1,
    lastReplyAt: Date.now(),
    participantIds: participants
  })
}

/** The mirror image: keep `replyCount` and `lastReplyAt` honest when a reply is
 *  deleted, otherwise the channel's thread indicator drifts upward forever and
 *  the Threads flyout (ordered by `by_workspace_last_reply`) ranks the thread by
 *  a message that no longer exists.
 *
 *  `lastReplyAt` is re-read from the newest surviving reply — one indexed `.take(1)`
 *  — falling back to `createdAt`, which is what the schema promises for a thread
 *  with no replies.
 *
 *  `participantIds` is deliberately *not* recomputed — someone who spoke in a
 *  thread stays a participant even if their message is gone (Discord does the
 *  same), and recomputing would mean scanning every remaining reply. */
export async function removeThreadReply(ctx: MutationCtx, threadId: Id<'threads'>): Promise<void> {
  const thread = await ctx.db.get(threadId)
  if (!thread) return

  // Runs *after* the reply row is deleted, so this sees only survivors.
  const [newest] = await ctx.db
    .query('messages')
    .withIndex('by_thread_created', (q) => q.eq('threadId', threadId))
    .order('desc')
    .take(1)

  await ctx.db.patch(threadId, {
    replyCount: Math.max(0, thread.replyCount - 1),
    lastReplyAt: newest?.createdAt ?? thread.createdAt
  })
}
