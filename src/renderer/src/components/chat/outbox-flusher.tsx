import { useEffect, useRef } from 'react'
import { useConvexAuth, useConvexConnectionState, useMutation } from 'convex/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { errorMessage } from '@renderer/lib/convex-error'
import { useOutboxStore } from '@renderer/store/outbox-store'

/** Drains the durable outbox. Mounted once, near the root.
 *
 *  Views never call `messages.send` themselves — they enqueue, and this sends. So
 *  a message typed offline, or one left behind by an app quit, is delivered the
 *  moment the socket is back.
 *
 *  A **server** rejection (empty body, lost membership, the reply target was
 *  deleted) is terminal: retrying forever would never succeed, so the entry is
 *  marked failed and the row offers Retry / Delete. A dropped connection is not a
 *  rejection — Convex holds the mutation and resolves it after reconnect. */
export function OutboxFlusher(): null {
  const entries = useOutboxStore((state) => state.entries)
  const settle = useOutboxStore((state) => state.settle)
  const markFailed = useOutboxStore((state) => state.markFailed)
  const send = useMutation(api.messages.send)
  const { isAuthenticated } = useConvexAuth()
  const { isWebSocketConnected } = useConvexConnectionState()

  /** In-flight `clientId`s, so a re-render can't send the same entry twice. */
  const inFlight = useRef(new Set<string>())

  useEffect(() => {
    if (!isAuthenticated || !isWebSocketConnected) return

    for (const entry of entries) {
      if (entry.error || inFlight.current.has(entry.clientId)) continue
      inFlight.current.add(entry.clientId)

      void send({
        channelId: entry.channelId as Id<'channels'>,
        body: entry.body,
        replyToId: entry.replyToId as Id<'messages'> | undefined,
        threadId: entry.threadId as Id<'threads'> | undefined,
        clientId: entry.clientId,
        // Only the key + metadata cross the wire; the bytes are already in R2.
        attachments: entry.attachments?.map(({ key, name, contentType, size }) => ({
          key,
          name,
          contentType,
          size
        }))
      })
        .then(() => settle(entry.clientId))
        .catch((error) => markFailed(entry.clientId, errorMessage(error, 'Could not send')))
        .finally(() => inFlight.current.delete(entry.clientId))
    }
  }, [entries, isAuthenticated, isWebSocketConnected, send, settle, markFailed])

  return null
}
