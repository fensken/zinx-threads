import type { Id } from '@convex/_generated/dataModel'
import type { ChatMessage } from '@renderer/components/chat/message-row'
import type { OutboxEntry } from '@renderer/store/outbox-store'

/** The author fields a pending row needs. Comes from the workspace directory —
 *  the sender is, by definition, a member. **Presence + custom status are carried too**
 *  so the optimistic row shows your ACTUAL status (Away / DND / a custom emoji), not a
 *  default "online" that then flips when the server message lands. */
export interface PendingAuthor {
  userId: string
  name: string
  color: string
  avatarUrl?: string | null
  presence?: string | null
  statusEmoji?: string | null
  statusText?: string | null
}

/** The strict author shape a rendered message row carries (presence is a narrow union). */
type MessageAuthor = NonNullable<ChatMessage['author']>

/** Turn an outbox entry into a row the message list can render.
 *
 *  The `_id` is the `clientId`, which is also the server's idempotency key — so
 *  when the real message arrives we can recognise and drop the pending twin. */
function toMessage(entry: OutboxEntry, author: PendingAuthor | undefined): ChatMessage {
  return {
    _id: entry.clientId as Id<'messages'>,
    _creationTime: entry.createdAt,
    channelId: entry.channelId as Id<'channels'>,
    workspaceId: '' as Id<'workspaces'>,
    authorId: (author?.userId ?? '') as Id<'users'>,
    body: entry.body,
    createdAt: entry.createdAt,
    threadId: entry.threadId as Id<'threads'> | undefined,
    replyToId: entry.replyToId as Id<'messages'> | undefined,
    author: author
      ? {
          name: author.name,
          color: author.color,
          avatarUrl: author.avatarUrl ?? undefined,
          // Match the real message's status so nothing flips when it lands. The directory
          // types presence loosely (string); it's the same value set as the message
          // author's narrow union, so narrow it back here.
          presence: (author.presence ?? undefined) as MessageAuthor['presence'],
          statusEmoji: author.statusEmoji ?? undefined,
          statusText: author.statusText ?? undefined
        }
      : null,
    reactions: [],
    // Show the local preview while the message is unsent; the server URL takes
    // over the moment it lands. `key: ''` — a pending attachment has no server url.
    attachments: entry.attachments?.map((a) => ({
      key: a.key,
      url: a.previewUrl ?? '',
      name: a.name,
      contentType: a.contentType,
      size: a.size
    })),
    // A pending message can't be replied-to, quoted or threaded yet, and it's
    // always ours.
    replyTo: null,
    thread: null,
    isAuthor: true,
    mentionsMe: false
  }
}

/** The outbox entries for one channel (or one thread) that the server hasn't
 *  echoed back yet, as message rows.
 *
 *  Entries are dropped once a server message carries the same `clientId` —
 *  otherwise the moment a send lands you'd see the message twice, once from the
 *  outbox and once from the query. (`_zinx` dedupes the same way.) */
export function pendingRows(options: {
  entries: OutboxEntry[]
  channelId: string
  /** Thread panel: only that thread's replies. Channel view: only non-thread. */
  threadId?: string
  serverMessages: readonly { clientId?: string }[] | undefined
  author: PendingAuthor | undefined
}): { message: ChatMessage; entry: OutboxEntry }[] {
  const acknowledged = new Set(
    (options.serverMessages ?? []).flatMap((message) =>
      message.clientId ? [message.clientId] : []
    )
  )
  return options.entries
    .filter(
      (entry) =>
        entry.channelId === options.channelId &&
        entry.threadId === options.threadId &&
        !acknowledged.has(entry.clientId)
    )
    .map((entry) => ({ message: toMessage(entry, options.author), entry }))
}

/** Server messages with the unsent ones appended, plus a lookup from a row's id
 *  back to its outbox entry.
 *
 *  One array, because grouping is positional: a pending message must group under
 *  the header of the message before it (and count toward the group-size cap) the
 *  same way a delivered one does. Rendering pending rows in a separate block
 *  after the list — always ungrouped — made your own message jump from its own
 *  header to a grouped row the instant the server acknowledged it.
 *
 *  `undefined` in, `undefined` out: the caller still needs to tell "loading" from
 *  "empty channel". */
export function mergePending<T extends ChatMessage>(
  serverMessages: readonly T[] | undefined,
  pending: { message: ChatMessage; entry: OutboxEntry }[]
): {
  messages: (T | ChatMessage)[] | undefined
  entryFor: (id: string) => OutboxEntry | undefined
} {
  const byId = new Map(pending.map(({ message, entry }) => [message._id as string, entry]))
  return {
    messages: serverMessages && [...serverMessages, ...pending.map(({ message }) => message)],
    entryFor: (id) => byId.get(id)
  }
}
