import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import type { StickToBottomContext } from 'use-stick-to-bottom'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import type { ChatMessage } from '@renderer/components/chat/message-row'

/** Newest N loaded first paint; grow by this much each scroll-to-top; hard cap.
 *  Mirror of the server's `CHANNEL_PAGE` / `CHANNEL_PAGE_MAX`. */
const INITIAL = 50
const STEP = 50
const MAX = 1000

/** Channel scrollback as a **growing reactive window**.
 *
 *  `messages.listByChannel` takes a `limit`; we start at `INITIAL` and grow it on
 *  scroll-to-top, so the whole thing stays one reactive `useQuery` — cached
 *  channel-switches and working optimistic reactions — over a widening window,
 *  rather than a stack of non-reactive pages.
 *
 *  Two subtleties this handles:
 *  1. Growing `limit` is a new query key → `undefined` until it loads. We keep
 *     the last defined value (`held`) so the list never flashes its loading state
 *     or loses scroll position mid-grow.
 *  2. Prepending older messages shifts everything down. We capture `scrollHeight`
 *     before the grow and, in a layout effect once the taller list has rendered,
 *     bump `scrollTop` by the delta — so the reader stays exactly where they were.
 *
 *  `conversationRef` is `use-stick-to-bottom`'s context (for the scroll element). */
export function useChannelScrollback(
  channelId: Id<'channels'>,
  conversationRef: React.RefObject<StickToBottomContext | null>
): {
  messages: ChatMessage[] | undefined
  loading: boolean
  loadingOlder: boolean
  hasMore: boolean
  loadOlder: () => void
} {
  const [limit, setLimit] = useState(INITIAL)
  const raw = useQuery(api.messages.listByChannel, { channelId, limit }) as
    ChatMessage[] | undefined

  // Keep the last defined value so a grow (new key → transient `undefined`)
  // doesn't unmount the list. Adjust-during-render — React's sanctioned pattern.
  const [held, setHeld] = useState<ChatMessage[] | undefined>(raw)
  if (raw !== undefined && raw !== held) setHeld(raw)
  const messages = raw ?? held

  const loading = messages === undefined
  const [loadingOlder, setLoadingOlder] = useState(false)
  const hasMore = messages !== undefined && messages.length >= limit && limit < MAX

  // Height snapshot taken at the moment we ask for more; `null` when not loading.
  const anchorHeight = useRef<number | null>(null)
  const busy = useRef(false)

  const loadOlder = useCallback(() => {
    if (busy.current) return
    const el = conversationRef.current?.scrollRef.current
    if (!el) return
    busy.current = true
    anchorHeight.current = el.scrollHeight
    setLoadingOlder(true)
    setLimit((current) => Math.min(current + STEP, MAX))
  }, [conversationRef])

  // Once the wider window has rendered, restore the reader's position.
  useLayoutEffect(() => {
    if (anchorHeight.current === null) return
    const el = conversationRef.current?.scrollRef.current
    // Adjusting a DOM element's scroll offset, not mutating React state — the ref
    // rule can't tell the difference.
    // eslint-disable-next-line react-hooks/immutability
    if (el) el.scrollTop += el.scrollHeight - anchorHeight.current
    anchorHeight.current = null
    busy.current = false
    setLoadingOlder(false)
    // `messages` is the dependency — the layout effect must run after the taller
    // list is in the DOM.
  }, [messages, conversationRef])

  return { messages, loading, loadingOlder, hasMore, loadOlder }
}
