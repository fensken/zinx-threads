import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { DateTimePicker } from '@renderer/components/common/date-time-picker'
import { DurationInput } from '@renderer/components/timer/duration-input'
import type { TimerTaskOption } from '@renderer/components/timer/timer-types'

const REASON_MIN = 3

/**
 * Add time by hand.
 *
 * **The reason is required**, and that is the whole difference between this and stopping a
 * timer. A timer-logged entry carries its own evidence — the clock ran, and what it measured
 * is stored beside what was logged. Hours typed in afterwards have nothing behind them but
 * the word of the person typing, so the record has to say why they exist. It goes into the
 * same permanent trail as every later edit.
 *
 * Uses the app's own `DateTimePicker` and `DurationInput` rather than native date/time
 * inputs — consistent with the event form, and the picker takes the workspace's zone, so
 * "9:00 AM on the 5th" is the team's 9am rather than the viewer's.
 */
export function ManualEntryDialog({
  open,
  onOpenChange,
  tasks,
  loadingTasks,
  zone,
  onSubmit
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: TimerTaskOption[]
  loadingTasks?: boolean
  zone: string
  onSubmit: (args: {
    taskId: string
    startedAt: number
    durationMs: number
    reason: string
    note?: string
    billable?: boolean
  }) => Promise<void>
}): React.JSX.Element {
  const [taskId, setTaskId] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<Date | undefined>(undefined)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [billable, setBillable] = useState(false)
  const [busy, setBusy] = useState(false)

  const ready =
    taskId !== null &&
    durationMs !== null &&
    startedAt !== undefined &&
    reason.trim().length >= REASON_MIN &&
    !busy

  const close = (next: boolean): void => {
    if (!next) {
      setTaskId(null)
      setStartedAt(undefined)
      setDurationMs(null)
      setReason('')
      setNote('')
      setBillable(false)
    }
    onOpenChange(next)
  }

  const submit = async (): Promise<void> => {
    if (!ready || taskId === null || durationMs === null || startedAt === undefined) return
    setBusy(true)
    try {
      await onSubmit({
        taskId,
        startedAt: startedAt.getTime(),
        durationMs,
        reason: reason.trim(),
        note: note.trim() || undefined,
        billable
      })
      close(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add time</DialogTitle>
          <DialogDescription>Log work done away from the timer.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">Task</Label>
            {/* A plain listbox rather than a Select: a board can have hundreds of tasks, and
                this stays scannable where a dropdown of 300 items does not. */}
            <div className="no-scrollbar max-h-40 overflow-y-auto rounded-md border p-1">
              {loadingTasks ? (
                <p className="p-2 text-sm text-muted-foreground">Loading tasks…</p>
              ) : tasks.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">This board has no tasks yet.</p>
              ) : (
                tasks.map((task) => (
                  <button
                    key={task.taskId}
                    type="button"
                    onClick={() => setTaskId(task.taskId)}
                    className={
                      'flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm transition-colors ' +
                      (taskId === task.taskId
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/60')
                    }
                  >
                    <span className="truncate">{task.title}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="entry-start" className="text-xs font-medium">
              Started at
            </Label>
            {/* The app's own date+time control (`common/date-time-picker.tsx`), the same one
                the event form uses — and it takes the zone, so "9:00 AM on the 5th" means the
                team's 9am rather than the viewer's. Native `<input type="date">` was wrong
                twice over: it looks different on every OS, and it has no idea about zones. */}
            <DateTimePicker
              id="entry-start"
              value={startedAt}
              onChange={setStartedAt}
              timeZone={zone}
              placeholder="Pick when the work started"
            />
          </div>

          <DurationInput value={durationMs} onChange={setDurationMs} label="Duration" />

          <div className="grid gap-1.5">
            <Label htmlFor="manual-reason" className="text-xs font-medium">
              Why is this being added by hand?
            </Label>
            <Input
              id="manual-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Worked offline on the client's site"
            />
            <p className="text-xs text-muted-foreground">
              Required. Kept permanently with the entry, alongside any later changes.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="manual-note" className="text-xs font-medium">
              Note <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="manual-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What did you work on?"
            />
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3 transition-colors hover:bg-accent/40">
            <span className="text-sm font-medium">Billable</span>
            <Switch checked={billable} onCheckedChange={setBillable} className="shrink-0" />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!ready}>
            <BusyLabel busy={busy} idle="Add time" busyText="Adding…" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
