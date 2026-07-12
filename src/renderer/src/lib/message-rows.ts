/** Consecutive messages from one author within this window collapse into a single
 *  visual group (avatar + header shown once). */
const GROUP_WINDOW_MS = 5 * 60 * 1000

/** …but a group never runs longer than this. Uncapped, someone typing forty
 *  lines in a row produces forty headerless rows: no avatar, no name, and — since
 *  the timestamp only renders on a group's header — no sense of when any of it
 *  was said. `_zinx` breaks every 8th message (`positionInChain % 8 !== 0`), so
 *  a group is one header plus seven grouped rows. Same here. */
const MAX_GROUP_SIZE = 8

function dayKey(ms: number): string {
  return new Date(ms).toDateString()
}

/** The minimum a message needs for grouping — so this works for channel messages
 *  and thread replies alike. */
interface GroupableMessage {
  _id: string
  authorId: string
  createdAt: number
  replyToId?: string
}

export type MessageRowEntry<T> =
  /** Day dividers carry the raw timestamp, not a label, so a ticking `now` never
   *  rebuilds the list. */
  { type: 'day'; key: string; at: number } | { type: 'msg'; message: T; grouped: boolean }

/** Fold a flat, chronological message list into day dividers + author-grouped
 *  rows. Shared by the channel view and the thread panel.
 *
 *  Pending (unsent) messages are appended to the same list before this runs, so
 *  they group against the server's newest message exactly as a delivered one
 *  would — and they count toward `MAX_GROUP_SIZE`. Otherwise your own message
 *  visibly re-flows the moment the server acknowledges it. */
export function buildMessageRows<T extends GroupableMessage>(
  messages: readonly T[] | undefined
): MessageRowEntry<T>[] {
  const out: MessageRowEntry<T>[] = []
  let prev: T | null = null
  /** Rows in the current group, counting its header. Reset to 1 on every header. */
  let groupSize = 0

  for (const message of messages ?? []) {
    if (!prev || dayKey(prev.createdAt) !== dayKey(message.createdAt)) {
      out.push({ type: 'day', key: `d-${message._id}`, at: message.createdAt })
      prev = null
    }
    // A reply always starts a fresh row — its quote needs the header above it.
    const grouped =
      !!prev &&
      !message.replyToId &&
      prev.authorId === message.authorId &&
      message.createdAt - prev.createdAt < GROUP_WINDOW_MS &&
      groupSize < MAX_GROUP_SIZE
    out.push({ type: 'msg', message, grouped })
    groupSize = grouped ? groupSize + 1 : 1
    prev = message
  }
  return out
}
