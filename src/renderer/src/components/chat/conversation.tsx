import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { ArrowDown } from '@phosphor-icons/react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import { MessageListSkeleton } from '@renderer/components/common/skeletons'
import { cn } from '@renderer/lib/utils'

/** Fills the message region while a `useQuery` is `undefined`.
 *
 *  It replaces the whole `<Conversation>` rather than sitting inside it: an empty
 *  `StickToBottom` would measure a zero-height list, then jump when the messages
 *  land. The composer stays mounted below, so the channel never looks broken.
 *
 *  A bottom-anchored message skeleton (not a spinner) so the swap to real messages
 *  doesn't move the composer or flash an empty column. */
export function ConversationLoading({ className }: { className?: string }): React.JSX.Element {
  return <MessageListSkeleton className={className} />
}

/** The scrolling message region, ported from `_zinx`'s `conversation.tsx` (same
 *  `use-stick-to-bottom` library): it keeps you pinned to the newest message
 *  while you're at the bottom, and lets go the moment you scroll up — including
 *  when late-loading images (GIFs) change the content height.
 *
 *  `_zinx` renders its list newest-first (reversed Virtuoso) so "latest" is the
 *  top; ours is chronological, so "latest" is the bottom. Same behaviour, flipped.
 *
 *  **`initial="instant"`, `resize="smooth"`.** The library applies `initial` to the
 *  *first* content measurement and `resize` to every later one. Opening a channel
 *  must land on the newest message with no visible travel — this is how Discord and
 *  Slack behave: the list is already scrolled to the bottom on first paint, and you
 *  never watch it fly down from the top. Growth *after* that (a message arrives, a
 *  GIF finishes loading, "Jump to latest") still animates. */
export function Conversation({
  className,
  ...props
}: ComponentProps<typeof StickToBottom>): React.JSX.Element {
  return (
    <StickToBottom
      className={cn('relative min-h-0 flex-1 overflow-y-hidden', className)}
      initial="instant"
      resize="smooth"
      role="log"
      {...props}
    />
  )
}

export function ConversationContent({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof StickToBottom.Content>, 'children'> & {
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <StickToBottom.Content className={cn('py-3', className)} {...props}>
      <InitialScrollToBottom />
      {children}
    </StickToBottom.Content>
  )
}

/** Pins the view to the bottom on first render, **before paint**, so opening a
 *  channel never flashes the top (oldest) messages first. `use-stick-to-bottom`'s
 *  `initial="instant"` scrolls from a ResizeObserver, which can land a frame after
 *  paint; a layout effect that jumps `scrollTop` to the bottom runs first, so the
 *  very first painted frame is already at the newest message (Discord/Slack land
 *  pre-scrolled the same way). Runs once — after that the library owns scrolling. */
function InitialScrollToBottom(): null {
  const { scrollRef } = useStickToBottomContext()
  const done = useRef(false)
  useLayoutEffect(() => {
    if (done.current) return
    const el = scrollRef.current
    if (el && el.scrollHeight > el.clientHeight) {
      el.scrollTop = el.scrollHeight
      done.current = true
    }
  })
  return null
}

/** Watches the scroll position and calls `onLoadOlder` when the reader nears the
 *  top — infinite scrollback. Rendered **inside** `<Conversation>` so it reads the
 *  scroll element from context. Renders nothing.
 *
 *  `enabled` is the "there's more, and we're not already loading" gate: when it
 *  flips false the listener detaches, which is what stops a single scroll from
 *  firing `loadOlder` repeatedly. */
export function ConversationScrollback({
  enabled,
  onLoadOlder
}: {
  enabled: boolean
  /** Must be stable (memoized) — it's an effect dependency. */
  onLoadOlder: () => void
}): null {
  const { scrollRef } = useStickToBottomContext()

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !enabled) return
    const onScroll = (): void => {
      if (el.scrollTop < 240) onLoadOlder()
    }
    // Fire once on attach too, in case the first window doesn't fill the viewport.
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef, enabled, onLoadOlder])

  return null
}

/** Floating "jump to latest" pill (mirrors `_zinx`'s `ScrollToTopButton`): shows
 *  only when you've scrolled away, and counts messages that arrived since. */
export function ConversationScrollButton({
  messages
}: {
  messages: { createdAt: number }[]
}): React.JSX.Element | null {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()

  // Watermark the newest message at the moment the reader scrolls away, so we can
  // count what has arrived since. Adjusted during render (React's recommended
  // alternative to a syncing effect) — same approach `_zinx` uses.
  const [awayAt, setAwayAt] = useState(0)
  const newest = messages.length ? messages[messages.length - 1].createdAt : 0
  if (!isAtBottom && awayAt === 0 && newest !== 0) setAwayAt(newest)
  if (isAtBottom && awayAt !== 0) setAwayAt(0)

  if (isAtBottom) return null

  const count = awayAt ? messages.filter((m) => m.createdAt > awayAt).length : 0

  return (
    <button
      type="button"
      onClick={() => void scrollToBottom()}
      className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-popover px-3 py-1.5 text-xs font-medium shadow-lg transition-colors hover:bg-accent"
    >
      {count > 0 ? `${count} new message${count === 1 ? '' : 's'}` : 'Jump to latest'}
      <ArrowDown className="size-3.5" weight="bold" />
    </button>
  )
}
