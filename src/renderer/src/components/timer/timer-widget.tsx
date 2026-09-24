import { useState } from 'react'
import {
  ClockCounterClockwise,
  Pause,
  Play,
  Plus,
  Trash,
  StopCircle,
  MoonStars,
  Lock,
  Hourglass
} from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { IconButton } from '@renderer/components/common/icon-button'
import { formatHms, formatHm } from '@renderer/components/timer/format-duration'
import { useElapsed } from '@renderer/components/timer/use-elapsed'
import type { AutoPauseReason, TrackedTimer } from '@renderer/components/timer/timer-types'
import { cn } from '@renderer/lib/utils'

/**
 * The timer surface: a compact trigger showing the live clock, and a popover with the
 * running timer, anything paused, and a way to start a new one.
 *
 * Purely presentational — every action is a prop, so the same component is driven by Convex
 * (`real-timer-widget.tsx`) and by the local store (`local-timer-widget.tsx`). Mirrors the
 * `board-view.tsx` ↔ `real-board-view.tsx` split.
 */

export interface TimerWidgetProps {
  timers: TrackedTimer[]
  loading?: boolean
  /** Today's logged total, for the popover footer. Omitted where it isn't known. */
  todayMs?: number
  onPause: (timer: TrackedTimer) => void
  onResume: (timer: TrackedTimer) => void
  /** May return a promise: the confirm dialog awaits it, so a failed discard keeps the
   *  dialog open with its error rather than closing as though it worked. */
  onDiscard: (timer: TrackedTimer) => void | Promise<void>
  /** Open the stop-and-log flow for this timer. */
  onLog: (timer: TrackedTimer, elapsedMs: number) => void
  onPickTask: () => void
  onOpenTimesheet?: () => void
}

/** Why a timer stopped without the user stopping it — said plainly, since the alternative
 *  is someone finding a paused clock and assuming the app lost their time. */
const AUTO_PAUSE_COPY: Record<AutoPauseReason, { icon: React.ElementType; text: string }> = {
  stale: { icon: Hourglass, text: 'Paused after running 12 hours' },
  sleep: { icon: MoonStars, text: 'Paused when your computer slept' },
  lock: { icon: Lock, text: 'Paused when your screen locked' },
  idle: { icon: Hourglass, text: 'Paused while you were away' }
}

export function TimerWidget({
  timers,
  loading,
  todayMs,
  onPause,
  onResume,
  onDiscard,
  onLog,
  onPickTask,
  onOpenTimesheet
}: TimerWidgetProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [discarding, setDiscarding] = useState<TrackedTimer | null>(null)
  const running = timers.find((timer) => timer.status === 'running') ?? null
  const paused = timers.filter((timer) => timer.status !== 'running')
  // One hook, always called, driven by whichever timer is running (or frozen at 0).
  const runningElapsed = useElapsed(running?.elapsedMs ?? 0, running !== null)

  const discardedMs =
    discarding === null ? 0 : discarding.id === running?.id ? runningElapsed : discarding.elapsedMs

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              title={running ? `Tracking: ${running.taskTitle}` : 'Time tracking'}
              aria-label={running ? `Tracking ${running.taskTitle}` : 'Time tracking'}
              className={cn(
                'app-no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
                running
                  ? 'bg-primary/15 text-primary hover:bg-primary/25'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {running ? (
                <>
                  {/* A categorical "live" cue, not decoration — it's how you tell at a glance
                    that something is being billed. */}
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="tabular-nums">{formatHms(runningElapsed)}</span>
                </>
              ) : (
                <>
                  <ClockCounterClockwise className="size-4 shrink-0" />
                  <span className="hidden sm:inline">Track</span>
                </>
              )}
            </button>
          }
        />
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Time tracking</span>
            {todayMs !== undefined ? (
              <span className="text-xs text-muted-foreground">{formatHm(todayMs)} today</span>
            ) : null}
          </div>

          <div className="no-scrollbar max-h-[60dvh] overflow-y-auto p-2">
            {loading ? (
              <div className="flex min-h-24 items-center justify-center">
                <Spinner className="size-4" />
              </div>
            ) : timers.length === 0 ? (
              <div className="flex min-h-24 flex-col items-center justify-center gap-1 px-4 text-center">
                <p className="text-sm font-medium">Nothing running</p>
                <p className="text-xs text-muted-foreground">
                  Start a timer on a board task to track your time.
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                {running ? (
                  <RunningCard
                    timer={running}
                    elapsedMs={runningElapsed}
                    onPause={() => onPause(running)}
                    onDiscard={() => setDiscarding(running)}
                    onLog={() => {
                      setOpen(false)
                      onLog(running, runningElapsed)
                    }}
                  />
                ) : null}
                {paused.length > 0 ? (
                  <div className="grid gap-1">
                    {running ? (
                      <p className="px-1 pt-1 text-xs font-medium text-muted-foreground">Paused</p>
                    ) : null}
                    {paused.map((timer) => (
                      <PausedRow
                        key={timer.id}
                        timer={timer}
                        onResume={() => onResume(timer)}
                        onDiscard={() => setDiscarding(timer)}
                        onLog={() => {
                          setOpen(false)
                          onLog(timer, timer.elapsedMs)
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t p-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setOpen(false)
                onPickTask()
              }}
            >
              <Plus className="size-4" />
              Start a timer
            </Button>
            {onOpenTimesheet ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpen(false)
                  onOpenTimesheet()
                }}
              >
                Timesheet
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>

      {/* Sibling of the popover, not a child: the popover closes when the dialog takes focus,
          and a confirm nested inside it would go with it.
          Discarding throws away tracked time and cannot be undone, so it confirms — and the
          dialog says exactly how much is about to go. */}
      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(next) => {
          if (!next) setDiscarding(null)
        }}
        title="Discard this timer?"
        description={
          discarding ? (
            <>
              <span className="font-medium text-foreground">{formatHms(discardedMs)}</span> tracked
              on “{discarding.taskTitle}” will be thrown away. Nothing is logged, and this can’t be
              undone.
            </>
          ) : null
        }
        confirmLabel="Discard timer"
        busyLabel="Discarding…"
        onConfirm={async () => {
          if (!discarding) return
          await onDiscard(discarding)
          setDiscarding(null)
        }}
      />
    </>
  )
}

function RunningCard({
  timer,
  elapsedMs,
  onPause,
  onDiscard,
  onLog
}: {
  timer: TrackedTimer
  elapsedMs: number
  onPause: () => void
  onDiscard: () => void
  onLog: () => void
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="truncate text-sm font-medium">{timer.taskTitle}</p>
      <p className="truncate text-xs text-muted-foreground">#{timer.channelName}</p>
      <p className="mt-2 font-mono text-2xl tabular-nums">{formatHms(elapsedMs)}</p>
      <div className="mt-2 flex items-center gap-1">
        <Button size="sm" onClick={onLog} className="flex-1">
          <StopCircle className="size-4" />
          Stop &amp; log
        </Button>
        <IconButton label="Pause" onClick={onPause}>
          <Pause className="size-4" />
        </IconButton>
        <IconButton label="Discard" onClick={onDiscard}>
          <Trash className="size-4" />
        </IconButton>
      </div>
    </div>
  )
}

function PausedRow({
  timer,
  onResume,
  onDiscard,
  onLog
}: {
  timer: TrackedTimer
  onResume: () => void
  onDiscard: () => void
  onLog: () => void
}): React.JSX.Element {
  const auto = timer.autoPausedReason ? AUTO_PAUSE_COPY[timer.autoPausedReason] : null
  const AutoIcon = auto?.icon
  return (
    <div className="rounded-lg border p-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{timer.taskTitle}</p>
          <p className="truncate text-xs text-muted-foreground">#{timer.channelName}</p>
        </div>
        <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
          {formatHms(timer.elapsedMs)}
        </span>
      </div>
      {auto && AutoIcon ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <AutoIcon className="size-3.5 shrink-0" />
          {auto.text}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-1">
        <Button size="sm" variant="outline" onClick={onResume} className="flex-1">
          <Play className="size-4" />
          Resume
        </Button>
        <Button size="sm" variant="ghost" onClick={onLog}>
          Log
        </Button>
        <IconButton label="Discard" onClick={onDiscard}>
          <Trash className="size-4" />
        </IconButton>
      </div>
    </div>
  )
}
