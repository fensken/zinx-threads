import type { FunctionArgs } from 'convex/server'
import type { api } from '@convex/_generated/api'

/** The Inbox's two filters, shared by the page (which offers both) and any other
 *  caller. Kept out of the component so the "what does All mean" answer lives in
 *  one place: `undefined`, i.e. no index bound at all. */

export type InboxKind = NonNullable<FunctionArgs<typeof api.inbox.listForMe>['kind']>

export const INBOX_KINDS: { value: InboxKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mention', label: 'Mentions' },
  { value: 'dm', label: 'Messages' },
  { value: 'reply', label: 'Replies' },
  { value: 'thread', label: 'Threads' }
]

export type InboxRange = 'any' | 'today' | 'week' | 'month'

export const INBOX_RANGES: { value: InboxRange; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' }
]

/** A range → the `since` bound the query wants.
 *
 *  **Computed in the viewer's own zone**, not the workspace's: "today" means the day
 *  *you* are having. Someone in Auckland asking for today's mentions means their
 *  today, even if the workspace's clock is still on yesterday.
 *
 *  **Every bound is a midnight**, never `now - 7 days`. That's partly what people mean
 *  by "last 7 days" (whole days, not a sliding instant), and partly load-bearing: this
 *  value is a Convex query *argument*, and Convex keys a subscription on the arguments.
 *  A bound derived from `Date.now()` is a different number on every render, so the
 *  Inbox would tear down and re-open a fresh subscription on each one — spinner, result,
 *  re-render, new key, spinner — a loop throttled only by the network round-trip, and
 *  one that leaks a subscription per iteration into the query cache. A stable bound for
 *  a stable filter is the fix; it only changes when the day does. */
export function sinceFor(range: InboxRange, now: number = Date.now()): number | undefined {
  if (range === 'any') return undefined
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (range === 'today') return start.getTime()
  const days = range === 'week' ? 7 : 30
  return start.getTime() - days * 24 * 60 * 60 * 1000
}
