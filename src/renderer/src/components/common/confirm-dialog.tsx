import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import { Spinner } from '@renderer/components/ui/spinner'
import { errorMessage } from '@renderer/lib/convex-error'
import { cn } from '@renderer/lib/utils'

/** The in-progress label, derived from the action's own verb — "Delete message"
 *  → "Deleting…", "Remove" → "Removing…" — so the spinner reads for the action
 *  you're taking, not a generic "Working…". */
const BUSY_VERB: Record<string, string> = {
  delete: 'Deleting…',
  remove: 'Removing…',
  leave: 'Leaving…',
  save: 'Saving…',
  create: 'Creating…',
  add: 'Adding…',
  send: 'Sending…',
  archive: 'Archiving…'
}
function busyTextFor(confirmLabel: string): string {
  const verb = confirmLabel.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return BUSY_VERB[verb] ?? 'Working…'
}

/** Reusable confirmation dialog — used for every destructive/delete action so the
 *  user always gets a prompt. Controlled via `open`/`onOpenChange`.
 *
 *  **Owns the whole confirm lifecycle**, because the base-nova `AlertDialogAction`
 *  is a plain button — it does NOT close the dialog, and firing an async mutation
 *  and forgetting it leaves the dialog open with no feedback. So on confirm we:
 *    1. show a spinner on the action button and disable both buttons,
 *    2. `await onConfirm()`,
 *    3. close on success, or keep the dialog open + toast on failure (the user
 *       can retry or cancel).
 *  While it's running the dialog can't be dismissed (Esc / backdrop / Cancel), so
 *  a delete can't be half-abandoned. `onConfirm` should therefore just return the
 *  mutation promise and **throw** on error — the caller no longer needs its own
 *  try/catch or toast. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  busyLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  /** Overrides the label shown beside the spinner; defaults to a verb derived
   *  from `confirmLabel` (e.g. "Delete message" → "Deleting…"). */
  busyLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const busyText = busyLabel ?? busyTextFor(confirmLabel)

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      await onConfirm()
      setBusy(false)
      onOpenChange(false)
    } catch (error) {
      setBusy(false)
      toast.error(errorMessage(error, 'Something went wrong. Please try again.'))
    }
  }

  return (
    <AlertDialog
      open={open}
      // Ignore user-initiated dismissals while the action runs; our own close
      // (above) happens only after `busy` is already back to false.
      onOpenChange={(next) => {
        if (busy && !next) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            // A plain button, not `AlertDialog.Close` — we control closing.
            onClick={(event) => {
              event.preventDefault()
              void confirm()
            }}
            className={cn(
              destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            )}
          >
            {busy ? (
              <>
                <Spinner className="size-4" />
                {busyText}
              </>
            ) : (
              confirmLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
