import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { CalendarDots, X } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { formatTimeInZone } from '@renderer/lib/timezone'
import { useNow } from '@renderer/lib/use-now'

/** "Starts in 8 minutes" / "Starting now" / "Started 3 minutes ago". */
function countdown(startAt: number, now: number): string {
  const minutes = Math.round((startAt - now) / 60_000)
  if (minutes > 60) {
    const hours = Math.round(minutes / 60)
    return `starts in ${hours} hour${hours === 1 ? '' : 's'}`
  }
  if (minutes > 1) return `starts in ${minutes} minutes`
  if (minutes === 1) return 'starts in a minute'
  if (minutes === 0) return 'starting now'
  const ago = Math.abs(minutes)
  return `started ${ago} minute${ago === 1 ? '' : 's'} ago`
}

/**
 * The reminder, made visible: a banner above the channel content once an event is
 * inside its own reminder window (`now >= startAt - reminderMinutes`).
 *
 * **Derived, not scheduled.** Nothing is queued when the event is saved — the window
 * is simply a function of `startAt` and `reminderMinutes`, evaluated against a
 * ticking clock. So moving an event, changing its reminder or deleting it can't leave
 * a stale job behind, and there's nothing to reconcile. The trade is honest and worth
 * stating: **it only fires while the app is open**. A push/email reminder that reaches
 * you when it isn't needs `ctx.scheduler` + a stored job list (what zinx-os does), and
 * is a separate piece of work.
 *
 * Only events with a reminder set, and only ones you haven't declined. Dismissing is
 * per-session and per-event — it's a nudge, not an inbox row.
 */
export function EventReminderBanner({
  workspaceId,
  workspaceSlug
}: {
  workspaceId: Id<'workspaces'>
  workspaceSlug: string
}): React.JSX.Element | null {
  const events = useQuery(api.events.listUpcoming, { workspaceId, limit: 5 })
  const navigate = useNavigate()
  const now = useNow().getTime()
  const [dismissed, setDismissed] = useState<string[]>([])

  const due = (events ?? []).find(
    (event) =>
      event.reminderMinutes > 0 &&
      event.myStatus !== 'declined' &&
      !dismissed.includes(event._id) &&
      // Inside the reminder window, and not yet finished.
      now >= event.startAt - event.reminderMinutes * 60_000 &&
      now < event.endAt
  )
  if (!due) return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-primary/10 px-3 py-1.5 text-xs text-primary">
      <CalendarDots className="size-4 shrink-0" weight="fill" />
      <button
        type="button"
        onClick={() =>
          void navigate({ to: '/w/$workspaceId/events', params: { workspaceId: workspaceSlug } })
        }
        className="min-w-0 flex-1 truncate text-left hover:underline"
      >
        <span className="font-semibold">{due.title}</span> {countdown(due.startAt, now)}
        {/* The workspace's clock — the same one the calendar is laid out in. */}
        <span className="ml-1 opacity-70">({formatTimeInZone(due.startAt, due.timezone)})</span>
      </button>
      <button
        type="button"
        aria-label="Dismiss reminder"
        title="Dismiss"
        onClick={() => setDismissed((current) => [...current, due._id])}
        className="flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-primary/20"
      >
        <X className="size-3.5" weight="bold" />
      </button>
    </div>
  )
}
