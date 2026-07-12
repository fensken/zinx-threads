import { useEffect, useRef } from 'react'
import { useMutation } from 'convex/react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'

/** Clears a channel's unread state while you're reading it.
 *
 *  Must be rendered **inside** `<Conversation>` — it needs `isAtBottom` from
 *  `use-stick-to-bottom`. Renders nothing.
 *
 *  Two conditions, both load-bearing:
 *  - **At the bottom.** Scrolled up to read history, new arrivals stay unread —
 *    that's what the "N new messages" pill is for. Marking them read here would
 *    make the pill announce messages the sidebar had already forgotten about.
 *  - **Tab visible.** A backgrounded or minimised window must accumulate unread,
 *    or the feature does nothing for the case it exists to serve. Discord gates on
 *    focus; `visibilitychange` is the portable signal and it fires on an Electron
 *    window being minimised or hidden.
 *
 *  `newestAt` is the `createdAt` of the newest message actually rendered, and it's
 *  what we send — not `Date.now()`. A message that lands between this render and
 *  the mutation must stay unread. */
export function MarkChannelRead({
  channelId,
  newestAt
}: {
  channelId: Id<'channels'>
  newestAt: number
}): null {
  const { isAtBottom } = useStickToBottomContext()
  const markRead = useMutation(api.unread.markRead)

  /** Highest `newestAt` we've already reported, per channel. Keeps a re-render (or
   *  a reconnect replaying the query) from firing the same mutation again. The
   *  server ignores a backwards mark anyway; this just avoids the round-trip. */
  const reported = useRef<{ channelId: string; at: number } | null>(null)

  useEffect(() => {
    if (newestAt === 0) return

    const send = (): void => {
      if (!isAtBottom || document.visibilityState !== 'visible') return
      const last = reported.current
      if (last && last.channelId === channelId && last.at >= newestAt) return
      reported.current = { channelId, at: newestAt }
      // Nothing to tell the user if this fails — the marker is advisory and the
      // next render, or the next visit, retries it.
      void markRead({ channelId, upTo: newestAt }).catch(() => {
        reported.current = null
      })
    }

    send()
    document.addEventListener('visibilitychange', send)
    return () => document.removeEventListener('visibilitychange', send)
  }, [channelId, newestAt, isAtBottom, markRead])

  return null
}
