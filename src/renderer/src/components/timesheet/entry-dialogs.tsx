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
import { Spinner } from '@renderer/components/ui/spinner'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { DurationInput } from '@renderer/components/timer/duration-input'
import { formatHm } from '@renderer/components/timer/format-duration'
import { formatDateTimeInZone } from '@renderer/lib/timezone'
import type { TimeEntryEdit, TimeEntryRow } from '@renderer/components/timer/timer-types'

/** The server enforces this too — the field just shouldn't let you submit something it will
 *  reject. */
const REASON_MIN = 3

/**
 * Edit an entry.
 *
 * The reason is **required**, and that is the point of the whole dialog: hours that can move
 * without a recorded explanation aren't a record, they're a draft. The field-level
 * before/after goes into an append-only trail that outlives the editor.
 */
export function EditEntryDialog({
  row,
  zone,
  onOpenChange,
  onSubmit
}: {
  row: TimeEntryRow | null
  zone: string
  onOpenChange: (open: boolean) => void
  onSubmit: (args: {
    durationMs?: number
    note?: string
    billable?: boolean
    reason: string
  }) => Promise<void>
}): React.JSX.Element {
  const [seededFor, setSeededFor] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(row?.durationMs ?? null)
  const [note, setNote] = useState(row?.note ?? '')
  const [billable, setBillable] = useState(row?.billable ?? false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  if (row && row.id !== seededFor) {
    setSeededFor(row.id)
    setDurationMs(row.durationMs)
    setNote(row.note ?? '')
    setBillable(row.billable)
    setReason('')
  } else if (!row && seededFor !== null) {
    setSeededFor(null)
  }

  const ready = durationMs !== null && reason.trim().length >= REASON_MIN && !busy

  const submit = async (): Promise<void> => {
    if (!row || !ready) return
    setBusy(true)
    try {
      await onSubmit({
        durationMs: durationMs ?? undefined,
        note: note.trim(),
        billable,
        reason: reason.trim()
      })
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit time entry</DialogTitle>
          <DialogDescription>
            {row ? `${row.taskTitle} · ${formatDateTimeInZone(row.startedAt, zone, true)}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <DurationInput value={durationMs} onChange={setDurationMs} label="Duration" autoFocus />

          <div className="grid gap-1.5">
            <Label htmlFor="entry-note" className="text-xs font-medium">
              Note
            </Label>
            <Input
              id="entry-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What was this time for?"
            />
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3 transition-colors hover:bg-accent/40">
            <span className="text-sm font-medium">Billable</span>
            <Switch checked={billable} onCheckedChange={setBillable} className="shrink-0" />
          </label>

          <div className="grid gap-1.5">
            <Label htmlFor="entry-reason" className="text-xs font-medium">
              Reason for the change
            </Label>
            <Input
              id="entry-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Forgot to include the review call"
            />
            <p className="text-xs text-muted-foreground">
              Recorded permanently, with what changed and who changed it.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!ready}>
            <BusyLabel busy={busy} idle="Save change" busyText="Saving…" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Remove or restore an entry. Both need a reason, for the same reason an edit does. */
export function ReasonDialog({
  row,
  mode,
  onOpenChange,
  onSubmit
}: {
  row: TimeEntryRow | null
  mode: 'delete' | 'restore'
  onOpenChange: (open: boolean) => void
  onSubmit: (reason: string) => Promise<void>
}): React.JSX.Element {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [seededFor, setSeededFor] = useState<string | null>(null)

  if (row && row.id !== seededFor) {
    setSeededFor(row.id)
    setReason('')
  } else if (!row && seededFor !== null) {
    setSeededFor(null)
  }

  const ready = reason.trim().length >= REASON_MIN && !busy
  const removing = mode === 'delete'

  const submit = async (): Promise<void> => {
    if (!row || !ready) return
    setBusy(true)
    try {
      await onSubmit(reason.trim())
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{removing ? 'Remove this entry?' : 'Restore this entry?'}</DialogTitle>
          <DialogDescription>
            {row ? `${row.taskTitle} · ${formatHm(row.durationMs)}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="reason-field" className="text-xs font-medium">
            Reason
          </Label>
          <Input
            id="reason-field"
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              removing ? 'e.g. Logged against the wrong task' : 'e.g. Removed by mistake'
            }
          />
          <p className="text-xs text-muted-foreground">
            {removing
              ? 'The entry is kept and stays visible under “Show removed”, with this reason.'
              : 'The entry returns to the timesheet and its total.'}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={removing ? 'destructive' : 'default'}
            onClick={() => void submit()}
            disabled={!ready}
          >
            <BusyLabel busy={busy} idle={removing ? 'Remove' : 'Restore'} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The audit trail for one entry — who changed what, when, and why. */
export function EntryHistoryDialog({
  row,
  edits,
  zone,
  loading,
  onOpenChange
}: {
  row: TimeEntryRow | null
  edits: TimeEntryEdit[]
  zone: string
  loading?: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change history</DialogTitle>
          <DialogDescription>{row?.taskTitle ?? ''}</DialogDescription>
        </DialogHeader>

        {/* A reserved height, so the card opens at one size whether it's loading, empty or
            full — the same rule the pinned-messages dialog follows. */}
        <div className="no-scrollbar min-h-48 max-h-[50dvh] overflow-y-auto">
          {loading ? (
            <div className="flex min-h-48 items-center justify-center">
              <Spinner className="size-4" />
            </div>
          ) : edits.length === 0 ? (
            <div className="flex min-h-48 items-center justify-center">
              <p className="text-sm text-muted-foreground">This entry hasn’t been changed.</p>
            </div>
          ) : (
            <ol className="grid gap-3">
              {edits.map((edit) => (
                <li key={edit.id} className="rounded-md border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      {edit.editorName}{' '}
                      <span className="font-normal text-muted-foreground">
                        {edit.kind === 'create'
                          ? 'added it by hand'
                          : edit.kind === 'edit'
                            ? 'edited it'
                            : edit.kind === 'delete'
                              ? 'removed it'
                              : 'restored it'}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTimeInZone(edit.at, zone, true)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{edit.reason}</p>
                  {edit.changes.length > 0 ? (
                    <ul className="mt-1 grid gap-0.5">
                      {edit.changes.map((change) => (
                        <li key={change.field} className="text-xs text-muted-foreground">
                          {change.field}: <s>{change.before}</s> → {change.after}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
