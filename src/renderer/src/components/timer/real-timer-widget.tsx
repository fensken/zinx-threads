import { useCallback, useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { errorMessage } from '@renderer/lib/convex-error'
import { useNow } from '@renderer/lib/use-now'
import { TimerWidget } from '@renderer/components/timer/timer-widget'
import { TaskPickerDialog } from '@renderer/components/timer/task-picker-dialog'
import { LogTimeDialog } from '@renderer/components/timer/log-time-dialog'
import type { TrackedTimer } from '@renderer/components/timer/timer-types'
import { dayBounds, weekBounds } from '@renderer/components/timesheet/timesheet-buckets'

/**
 * The Convex adapter for the timer — the `real-board-view.tsx` of this feature.
 *
 * Scoped to **one kanban channel**: time tracking is a board feature, so the widget lives in
 * the board's header and only ever shows timers running against tasks on this board. That
 * makes the task picker a single bounded read (this board's tasks) instead of a cross-board
 * search that Convex could not index anyway.
 */
export function RealTimerWidget({
  channelId,
  workspaceId,
  timezone
}: {
  channelId: Id<'channels'>
  workspaceId: Id<'workspaces'>
  /** The workspace's zone — "today" is the team's day, not the viewer's. */
  timezone: string
}): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [logging, setLogging] = useState<{ timer: TrackedTimer; trackedMs: number } | null>(null)

  const data = useQuery(api.timer.mine, { workspaceId })
  // `useNow` rather than `Date.now()`: reading the clock during render is impure, and this
  // also rolls the range over at midnight on its own.
  const now = useNow().getTime()
  const bounds = useMemo(() => {
    const today = dayBounds(now, timezone)
    const week = weekBounds(now, timezone)
    return { todayFrom: today.from, todayTo: today.to, weekFrom: week.from, weekTo: week.to }
  }, [now, timezone])
  const totals = useQuery(api.timesheets.myTotals, { channelId, ...bounds })
  const tasks = useQuery(api.timesheets.taskOptions, pickerOpen ? { channelId } : 'skip')

  const startTimer = useMutation(api.timer.start)
  const pauseTimer = useMutation(api.timer.pause)
  const resumeTimer = useMutation(api.timer.resume)
  const discardTimer = useMutation(api.timer.discard)
  const logTimer = useMutation(api.timesheets.logTimer)

  const guard = useCallback(async (promise: Promise<unknown>, fallback: string): Promise<void> => {
    try {
      await promise
    } catch (error) {
      toast.error(errorMessage(error, fallback))
    }
  }, [])

  // `timer.mine` is workspace-wide (one person has one running clock, wherever it is), but
  // this widget belongs to a board — so it shows only the timers pointing at this one.
  const timers: TrackedTimer[] = useMemo(
    () =>
      (data?.timers ?? [])
        .filter((timer) => timer.channelId === channelId)
        .map((timer) => ({
          id: timer._id,
          taskId: timer.taskId,
          channelId: timer.channelId,
          taskTitle: timer.taskTitle,
          channelName: timer.channelName,
          status: timer.status,
          elapsedMs: timer.elapsedMs,
          note: timer.note,
          autoPausedAt: timer.autoPausedAt,
          autoPausedReason: timer.autoPausedReason
        })),
    [data, channelId]
  )

  return (
    <>
      <TimerWidget
        timers={timers}
        loading={data === undefined}
        todayMs={totals?.todayMs}
        onPause={(timer) =>
          void guard(pauseTimer({ timerId: timer.id as Id<'timerStates'> }), 'Could not pause')
        }
        onResume={(timer) =>
          void guard(resumeTimer({ timerId: timer.id as Id<'timerStates'> }), 'Could not resume')
        }
        // Returned, not `void`-ed: the confirm dialog awaits it and keeps itself open with
        // the error if the discard fails.
        onDiscard={(timer) => discardTimer({ timerId: timer.id as Id<'timerStates'> }).then()}
        onLog={(timer, elapsedMs) => setLogging({ timer, trackedMs: Math.round(elapsedMs) })}
        onPickTask={() => setPickerOpen(true)}
      />

      <TaskPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        tasks={(tasks ?? []).map((task) => ({
          taskId: task._id,
          title: task.title,
          estimateMs: task.estimateMs
        }))}
        loading={tasks === undefined}
        onPick={(taskId) => {
          setPickerOpen(false)
          void guard(
            startTimer({ taskId: taskId as Id<'kanbanTasks'> }),
            'Could not start the timer'
          )
        }}
      />

      <LogTimeDialog
        timer={logging?.timer ?? null}
        trackedMs={logging?.trackedMs ?? 0}
        onOpenChange={(next) => {
          if (!next) setLogging(null)
        }}
        onSubmit={async ({ durationMs, note, billable }) => {
          if (!logging) return
          await guard(
            logTimer({
              timerId: logging.timer.id as Id<'timerStates'>,
              durationMs,
              note,
              billable
            }),
            'Could not log the time'
          )
          setLogging(null)
        }}
      />
    </>
  )
}
