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
import { DurationInput } from '@renderer/components/timer/duration-input'
import { formatHm } from '@renderer/components/timer/format-duration'
import type { TrackedTimer } from '@renderer/components/timer/timer-types'

/**
 * Stop a timer and commit it.
 *
 * The measured time is shown next to the editable amount rather than being quietly
 * replaced by it: rounding 52 minutes up to an hour is normal and fine, but the fact that
 * you did so is part of the record. The backend stores both (`trackedMs` beside
 * `durationMs`) for the same reason.
 *
 * The duration is captured **once**, when the dialog opens. If it kept ticking, the number
 * you were about to confirm would change under your cursor.
 */
export function LogTimeDialog({
  timer,
  trackedMs,
  defaultBillable,
  onOpenChange,
  onSubmit
}: {
  /** The timer being logged; `null` closes the dialog. */
  timer: TrackedTimer | null
  /** Elapsed at the moment the dialog opened — frozen on purpose. */
  trackedMs: number
  defaultBillable?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (args: { durationMs: number; note?: string; billable?: boolean }) => Promise<void>
}): React.JSX.Element {
  const [seededFor, setSeededFor] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(trackedMs)
  const [note, setNote] = useState('')
  const [billable, setBillable] = useState(defaultBillable ?? false)
  const [busy, setBusy] = useState(false)

  // Seed from the timer being stopped — adjusted during render, the documented alternative
  // to a syncing effect, so the dialog never flashes an empty duration.
  if (timer && timer.id !== seededFor) {
    setSeededFor(timer.id)
    setDurationMs(trackedMs)
    setNote(timer.note ?? '')
    setBillable(defaultBillable ?? false)
  } else if (!timer && seededFor !== null) {
    setSeededFor(null)
  }

  const submit = async (): Promise<void> => {
    if (!timer || durationMs === null || busy) return
    setBusy(true)
    try {
      await onSubmit({ durationMs, note: note.trim() || undefined, billable })
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  const adjusted = durationMs !== null && Math.abs(durationMs - trackedMs) >= 60_000

  return (
    <Dialog open={timer !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log time</DialogTitle>
          <DialogDescription>
            {timer ? `${timer.taskTitle} · #${timer.channelName}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <DurationInput
            value={durationMs}
            onChange={setDurationMs}
            label="Time to log"
            autoFocus
            hint={
              adjusted ? `The timer measured ${formatHm(trackedMs)}. Both are kept.` : undefined
            }
          />

          <div className="grid gap-1.5">
            <Label htmlFor="log-note" className="text-xs font-medium">
              Note <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="log-note"
              value={note}
              placeholder="What did you work on?"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3 transition-colors hover:bg-accent/40">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Billable</span>
              <span className="block text-xs text-muted-foreground">
                Counted separately in the timesheet total.
              </span>
            </span>
            <Switch checked={billable} onCheckedChange={setBillable} className="shrink-0" />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={durationMs === null || busy}>
            <BusyLabel busy={busy} idle="Log time" busyText="Logging…" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
