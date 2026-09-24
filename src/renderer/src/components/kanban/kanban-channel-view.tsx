import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { Kanban as BoardIcon, ClockCounterClockwise } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Doc } from '@convex/_generated/dataModel'
import { safeZone } from '@renderer/lib/timezone'
import { RealBoardView } from '@renderer/components/kanban/real-board-view'
import { RealTimerWidget } from '@renderer/components/timer/real-timer-widget'
import { RealTimesheetView } from '@renderer/components/timesheet/real-timesheet-view'
import { cn } from '@renderer/lib/utils'

/**
 * A `kanban` channel: its **board** and its **timesheet**, as two views of the same thing.
 *
 * Time tracking is a board feature, not a workspace one — you track time against tasks, and
 * the hours belong to the board those tasks live on. So the timer lives here, in the board's
 * own header, and appears nowhere else in the app; the timesheet is the second tab rather
 * than a separate destination.
 *
 * That scoping is also what keeps the authorization simple: every time query takes this
 * `channelId` and is gated by `getChannelAccess`, so a private board's hours cannot be
 * reached from outside it. See the note in `convex/lib/timesheet.ts`.
 */
type BoardTab = 'board' | 'timesheet'

export function KanbanChannelView({ channel }: { channel: Doc<'channels'> }): React.JSX.Element {
  // Deliberately component state, not a URL segment: this is a view toggle inside one
  // channel (like the calendar's Month/Upcoming switch), not a place you navigate to. The
  // channel is what the URL names.
  const [tab, setTab] = useState<BoardTab>('board')

  // The workspace's zone decides which day an entry falls on. The shell already subscribes
  // to this exact query, so the cache dedupes it — no extra round trip.
  const params = useParams({ strict: false }) as { workspaceId?: string }
  const workspace = useQuery(
    api.workspaces.getBySlug,
    params.workspaceId ? { slug: params.workspaceId } : 'skip'
  )
  const zone = safeZone(workspace?.workspace.timezone)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <TabButton
          active={tab === 'board'}
          onClick={() => setTab('board')}
          icon={<BoardIcon className="size-4" />}
          label="Board"
        />
        <TabButton
          active={tab === 'timesheet'}
          onClick={() => setTab('timesheet')}
          icon={<ClockCounterClockwise className="size-4" />}
          label="Timesheet"
        />
        {/* The timer stays mounted across both tabs — stopping the clock just because you
            looked at the timesheet would be absurd. */}
        <div className="ml-auto">
          <RealTimerWidget
            channelId={channel._id}
            workspaceId={channel.workspaceId}
            timezone={zone}
          />
        </div>
      </div>

      {/* Only the active view is mounted: the board holds drag state and the timesheet holds
          a live query, and neither should be doing work while it isn't on screen. */}
      {tab === 'board' ? (
        <RealBoardView channel={channel} />
      ) : (
        <RealTimesheetView channelId={channel._id} channelName={channel.name} zone={zone} />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
        active
          ? 'bg-accent font-medium text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  )
}
