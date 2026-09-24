import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import {
  ArrowRight,
  ClockCounterClockwise,
  Pause,
  Play,
  StopCircle,
  Trash
} from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { IconButton } from '@renderer/components/common/icon-button'
import { convexEnabled } from '@renderer/lib/auth-client'
import { errorMessage } from '@renderer/lib/convex-error'
import { formatHms } from '@renderer/components/timer/format-duration'
import { useElapsed } from '@renderer/components/timer/use-elapsed'
import { LogTimeDialog } from '@renderer/components/timer/log-time-dialog'
import type { TrackedTimer } from '@renderer/components/timer/timer-types'
import { cn } from '@renderer/lib/utils'

/**
 * The app header's time tracker.
 *
 * Time tracking belongs to kanban channels — but a *running* clock must not disappear the
 * moment you navigate away from the board, or you forget it and the 12h cron ends up being
 * the thing that stops it. So the header carries the live state wherever you are, and each
 * timer links back to the board it belongs to.
 *
 * It renders **nothing** in a workspace with no kanban channels: a Track button in a
 * workspace that has nothing to track is a dead control. It also renders nothing outside a
 * workspace (sign-in, onboarding, `/docs`).
 *
 * Starting a timer is deliberately NOT done here. Picking a task means picking a board
 * first, and the board already has that picker in its own header — so this offers "go to the
 * board" instead of rebuilding a cross-board search that Convex can't index cheaply anyway.
 */
export function HeaderTimer(): React.JSX.Element | null {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const slug = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null

  const workspace = useQuery(
    api.workspaces.getBySlug,
    convexEnabled && slug ? { slug: decodeURIComponent(slug) } : 'skip'
  )
  const workspaceId = workspace?.workspace._id

  const data = useQuery(api.timer.mine, workspaceId ? { workspaceId } : 'skip')
  const boards = useQuery(api.timesheets.trackableBoards, workspaceId ? { workspaceId } : 'skip')

  const timers: TrackedTimer[] = useMemo(
    () =>
      (data?.timers ?? []).map((timer) => ({
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
    [data]
  )

  // Hooks must run unconditionally, so every decision to hide happens after them.
  const hasBoards = (boards?.length ?? 0) > 0
  if (!convexEnabled || !slug || !workspaceId) return null
  if (!hasBoards && timers.length === 0) return null

  return <HeaderTimerContent timers={timers} workspaceSlug={workspace.workspace.slug} />
}

function HeaderTimerContent({
  timers,
  workspaceSlug
}: {
  timers: TrackedTimer[]
  workspaceSlug: string
}): React.JSX.Element {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [logging, setLogging] = useState<{ timer: TrackedTimer; trackedMs: number } | null>(null)
  const [discarding, setDiscarding] = useState<TrackedTimer | null>(null)

  const running = timers.find((timer) => timer.status === 'running') ?? null
  const paused = timers.filter((timer) => timer.status !== 'running')
  const elapsed = useElapsed(running?.elapsedMs ?? 0, running !== null)

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

  const goToBoard = useCallback(
    (channelName: string) => {
      setOpen(false)
      void navigate({
        to: '/w/$workspaceId/$channelSlug',
        params: { workspaceId: workspaceSlug, channelSlug: channelName }
      })
    },
    [navigate, workspaceSlug]
  )

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
                  : paused.length > 0
                    ? 'bg-muted text-muted-foreground hover:bg-muted/80'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {running ? (
                <>
                  {/* A categorical "live" cue — how you tell at a glance that a clock is
                      running, from anywhere in the app. */}
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="tabular-nums">{formatHms(elapsed)}</span>
                </>
              ) : (
                <>
                  <ClockCounterClockwise className="size-4 shrink-0" />
                  <span className="hidden sm:inline">{paused.length > 0 ? 'Paused' : 'Track'}</span>
                </>
              )}
            </button>
          }
        />
        <PopoverContent align="end" className="w-80 p-0">
          <div className="border-b px-3 py-2">
            <span className="text-sm font-semibold">Time tracking</span>
          </div>

          <div className="no-scrollbar max-h-[60dvh] overflow-y-auto p-2">
            {timers.length === 0 ? (
              <div className="flex min-h-24 flex-col items-center justify-center gap-1 px-4 text-center">
                <p className="text-sm font-medium">Nothing running</p>
                <p className="text-xs text-muted-foreground">
                  Open a board to start tracking a task.
                </p>
              </div>
            ) : (
              <div className="grid gap-1.5">
                {timers.map((timer) => (
                  <div
                    key={timer.id}
                    className={cn(
                      'rounded-lg border p-2',
                      timer.status === 'running' && 'border-primary/40 bg-primary/5'
                    )}
                  >
                    {/* Each row opens ITS OWN board. Timers can come from different kanban
                        channels, so a single "open board" action at the bottom of the list
                        could only ever guess which one you meant. */}
                    <button
                      type="button"
                      onClick={() => goToBoard(timer.channelName)}
                      title={`Open #${timer.channelName}`}
                      className="group/row -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {timer.taskTitle}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          #{timer.channelName}
                        </span>
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100" />
                    </button>
                    <div className="mt-1.5 flex items-center gap-1">
                      <span className="flex-1 font-mono text-sm tabular-nums">
                        {formatHms(timer.status === 'running' ? elapsed : timer.elapsedMs)}
                      </span>
                      {timer.status === 'running' ? (
                        <IconButton
                          label="Pause"
                          onClick={() =>
                            void guard(
                              pauseTimer({ timerId: timer.id as Id<'timerStates'> }),
                              'Could not pause'
                            )
                          }
                        >
                          <Pause className="size-4" />
                        </IconButton>
                      ) : (
                        <IconButton
                          label="Resume"
                          onClick={() =>
                            void guard(
                              resumeTimer({ timerId: timer.id as Id<'timerStates'> }),
                              'Could not resume'
                            )
                          }
                        >
                          <Play className="size-4" />
                        </IconButton>
                      )}
                      <IconButton
                        label="Stop and log"
                        onClick={() => {
                          setOpen(false)
                          setLogging({
                            timer,
                            trackedMs: Math.round(
                              timer.status === 'running' ? elapsed : timer.elapsedMs
                            )
                          })
                        }}
                      >
                        <StopCircle className="size-4" />
                      </IconButton>
                      <IconButton label="Discard" onClick={() => setDiscarding(timer)}>
                        <Trash className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Discarding throws away tracked time and cannot be undone — so it confirms, and the
          dialog says exactly how much is about to go. "Log it instead" is offered because
          that is almost always what the person actually wants. */}
      <ConfirmDialog
        open={discarding !== null}
        onOpenChange={(open) => {
          if (!open) setDiscarding(null)
        }}
        title="Discard this timer?"
        description={
          discarding ? (
            <>
              <span className="font-medium text-foreground">
                {formatHms(
                  discarding.status === 'running' && discarding.id === running?.id
                    ? elapsed
                    : discarding.elapsedMs
                )}
              </span>{' '}
              tracked on “{discarding.taskTitle}” will be thrown away. Nothing is logged, and this
              can’t be undone.
            </>
          ) : null
        }
        confirmLabel="Discard timer"
        busyLabel="Discarding…"
        onConfirm={async () => {
          if (!discarding) return
          await discardTimer({ timerId: discarding.id as Id<'timerStates'> })
          setDiscarding(null)
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
