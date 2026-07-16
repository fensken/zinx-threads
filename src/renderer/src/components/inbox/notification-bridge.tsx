import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useConvexAuth } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import { messagePreview } from '@renderer/lib/message-preview'
import { platform } from '@renderer/lib/platform'
import { playNotificationSound } from '@renderer/lib/sounds'
import { useSettingsStore } from '@renderer/store/settings-store'
import type { InboxItem } from '@renderer/lib/use-open-inbox-item'

/** How many recent rows we watch. Anything older than this can't be "new". */
const WATCH = 10

/**
 * Turns an inbox row into a notification — a **sound**, an **OS notification**, and
 * the **dock badge**.
 *
 * Everything about *whether to interrupt* lives here, deliberately, rather than being
 * split across the IPC boundary:
 *
 *  - **Only genuinely new rows.** The first result is a *seed*, not an event: on
 *    sign-in you have a backlog, and firing a notification per unread message would
 *    be an avalanche. Ids seen in that first snapshot are remembered and never
 *    notified.
 *  - **Focused → sound only.** If you're looking at the app, a chime tells you
 *    something arrived; an OS banner over the window you're already reading is noise.
 *    Unfocused (or minimised, or another desktop) → banner *and* chime, which is what
 *    Slack and Discord both do.
 *  - **Already read → nothing.** Reading a mention on your phone shouldn't make your
 *    laptop chime a second later.
 *
 * Clicking the notification routes you to the message (main focuses the window first).
 *
 * Mounted once, in `__root.tsx`. Its query is the same `inbox.listForMe` the header
 * flyout uses, so Convex dedupes the subscription — this costs no extra socket work.
 */
export function NotificationBridge(): null {
  // **The seed must be an authenticated snapshot.** This component is mounted above
  // `AuthGate`, and at boot the auth token is still being fetched (over async IPC on
  // desktop) — so Convex runs the query unauthenticated first, and `inbox.listForMe`
  // returns `[]` for a signed-out caller. Seeding from *that* would leave `seen` empty,
  // and the moment the token landed the entire backlog would read as brand new: a chime
  // and an OS banner for messages from last week, on every single launch. Which is the
  // exact avalanche this component's first rule exists to prevent.
  const { isAuthenticated } = useConvexAuth()
  const items = useQuery(api.inbox.listForMe, { limit: WATCH })
  const navigate = useNavigate()

  /** Ids we've already accounted for. Seeded from the first authenticated snapshot;
   *  reset on sign-out so the next user doesn't inherit this one's. */
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      seen.current = null
      return
    }
    if (!items) return

    // First snapshot: remember what's already there, announce nothing.
    if (seen.current === null) {
      seen.current = new Set(items.map((item) => item._id))
      return
    }

    const fresh = items.filter((item) => !seen.current!.has(item._id) && !item.read)
    for (const item of items) seen.current.add(item._id)
    if (fresh.length === 0) return

    const { soundEnabled, desktopNotifications } = useSettingsStore.getState()
    // `hasFocus()` rather than `document.hidden`: a window can be visible but behind
    // another one, and that still counts as "not looking at it".
    const focused = document.hasFocus()

    if (soundEnabled) playNotificationSound()

    if (!focused && desktopNotifications) {
      // One banner even if several landed at once — a stack of them is the thing
      // people turn notifications off over.
      const [first] = fresh
      const title = titleFor(first)
      const body =
        fresh.length > 1
          ? `${messagePreview(first.body).text}  ·  +${fresh.length - 1} more`
          : messagePreview(first.body).text
      // A stable tag so a second batch replaces the first on the OS rather than stacking —
      // the same "one banner, not a pile" intent, extended past the single render.
      platform.notify({ title, body, route: routeFor(first), tag: 'zinx-inbox' })
    }
  }, [items, isAuthenticated])

  // The dock/taskbar badge — the count you see without switching to the app.
  const unread = useQuery(api.inbox.unreadCountForMe, {})
  useEffect(() => {
    platform.setBadgeCount(unread?.count ?? 0)
  }, [unread?.count])

  // Clicking a notification: main has already raised the window; we navigate.
  useEffect(() => {
    return platform.onNotificationClick((route) => {
      void navigate({ to: route })
    })
  }, [navigate])

  return null
}

/** "Alice in #general" / "Alice" (a DM has no channel to name — and its stored name
 *  is an id, which must never be rendered). */
function titleFor(item: InboxItem): string {
  if (item.channelKind === 'dm') return item.actorName
  return `${item.actorName} in #${item.channelName}`
}

/** Where clicking it lands. A string (not a route object) because it crosses the IPC
 *  boundary as an opaque payload. */
function routeFor(item: InboxItem): string {
  if (item.channelKind === 'dm') {
    return `/w/${item.workspaceSlug}/d/${item.channelId}`
  }
  return `/w/${item.workspaceSlug}/${item.channelName}`
}
