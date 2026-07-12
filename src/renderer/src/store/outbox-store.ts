import { create } from 'zustand'

/** An uploaded file, already PUT to R2 (`useUploadFile` returned the `key`),
 *  waiting to ride a message. `messages.send` resolves the `key` to a URL; the
 *  optional `previewUrl` is a local `blob:` URL for the pending row only (it dies
 *  on quit — fine, the message lands with the real URL). */
export interface OutboxAttachment {
  key: string
  name: string
  contentType: string
  size: number
  previewUrl?: string
}

/** A message you typed that the server hasn't acknowledged yet.
 *
 *  Convex queues mutations across a reconnect, but **only in memory** — quit the
 *  app with a send in flight and it's gone. Discord and Slack both persist an
 *  outbox to disk; this is ours. Each entry carries a `clientId`, which
 *  `messages.send` uses as an idempotency key so a replay after a lost ack can't
 *  post the message twice. */
export interface OutboxEntry {
  clientId: string
  channelId: string
  /** Present when the message is a reply inside a thread. */
  threadId?: string
  replyToId?: string
  /** Shown in the pending row, and re-armed if you retry. */
  replyToAuthorName?: string
  body: string
  createdAt: number
  /** Files uploaded with this message (their bytes are already in R2). */
  attachments?: OutboxAttachment[]
  /** Set when the **server** rejected it. Auto-retry stops; the row offers
   *  Retry / Delete. A dropped connection is not a failure — Convex retries. */
  error?: string
}

const KEY = 'zinx-outbox'
/** A runaway outbox would grow without bound in localStorage. */
const MAX_ENTRIES = 200

function read(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : []
  } catch {
    // A corrupt outbox must not take the app down on boot.
    return []
  }
}

function write(entries: OutboxEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // Quota exceeded — the in-memory copy still works for this session.
  }
}

interface OutboxState {
  entries: OutboxEntry[]
  enqueue: (entry: OutboxEntry) => void
  /** The server accepted it (or told us it already had it). */
  settle: (clientId: string) => void
  markFailed: (clientId: string, error: string) => void
  /** Clear the error so the flusher picks it up again. */
  retry: (clientId: string) => void
  discard: (clientId: string) => void
}

export const useOutboxStore = create<OutboxState>((set) => {
  const commit = (entries: OutboxEntry[]): { entries: OutboxEntry[] } => {
    write(entries)
    return { entries }
  }
  return {
    entries: read(),
    enqueue: (entry) => set((state) => commit([...state.entries, entry])),
    settle: (clientId) =>
      set((state) => commit(state.entries.filter((e) => e.clientId !== clientId))),
    markFailed: (clientId, error) =>
      set((state) =>
        commit(state.entries.map((e) => (e.clientId === clientId ? { ...e, error } : e)))
      ),
    retry: (clientId) =>
      set((state) =>
        commit(state.entries.map((e) => (e.clientId === clientId ? { ...e, error: undefined } : e)))
      ),
    discard: (clientId) =>
      set((state) => commit(state.entries.filter((e) => e.clientId !== clientId)))
  }
})
