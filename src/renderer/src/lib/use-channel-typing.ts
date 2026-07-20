import { useCallback, useEffect, useRef } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'

/**
 * Live "someone is typing…" for one channel. Mirrors the server's ephemeral model
 * (`convex/typing.ts`): the composer calls `notifyTyping()` on each edit — we THROTTLE
 * it to at most one `start` mutation per `THROTTLE_MS` so a fast typist doesn't spam
 * writes — and `notifyStopped()` on send/blur. The row self-expires server-side, but we
 * also delete it explicitly on stop and on unmount / channel change, so the indicator
 * clears instantly for others instead of waiting out the TTL.
 *
 * Pass `undefined` (mock / no channel) to make every op a no-op and the list empty.
 */
const THROTTLE_MS = 3_000

export type TypingUser = { userId: string; name: string }

export function useChannelTyping(channelId: Id<'channels'> | undefined): {
  typingUsers: TypingUser[]
  notifyTyping: () => void
  notifyStopped: () => void
} {
  const start = useMutation(api.typing.start)
  const stop = useMutation(api.typing.stop)
  const lastPing = useRef(0)
  const active = useRef(false)

  const typingUsers = useQuery(api.typing.listByChannel, channelId ? { channelId } : 'skip') ?? []

  const notifyTyping = useCallback(() => {
    if (!channelId) return
    const now = Date.now()
    if (now - lastPing.current < THROTTLE_MS) return
    lastPing.current = now
    active.current = true
    void start({ channelId }).catch(() => {})
  }, [channelId, start])

  const notifyStopped = useCallback(() => {
    lastPing.current = 0
    if (!channelId || !active.current) return
    active.current = false
    void stop({ channelId }).catch(() => {})
  }, [channelId, stop])

  // Stop typing when the composer unmounts or the channel changes — otherwise the row
  // would linger the full TTL after you navigate away mid-sentence.
  useEffect(() => {
    return () => {
      if (channelId && active.current) {
        active.current = false
        void stop({ channelId }).catch(() => {})
      }
    }
  }, [channelId, stop])

  return { typingUsers, notifyTyping, notifyStopped }
}
