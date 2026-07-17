import { useState } from 'react'
import { Trash } from '@phosphor-icons/react'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { errorMessage } from '@renderer/lib/convex-error'

/**
 * The "Delete this workspace" danger card — **the one component both the online and
 * local Danger panes render**, so the delete UX is identical: a destructive-bordered
 * card that expands into a **type-the-name-to-confirm** inline form. The caller owns the
 * actual deletion (`onDelete` receives the confirmed name and, on success, closes/navigates
 * away). Purely presentational — no Convex, no store — so local can reuse it verbatim.
 */
export function WorkspaceDeleteCard({
  workspaceName,
  description = 'Permanently removes the workspace and everything in it. This can’t be undone.',
  onDelete
}: {
  workspaceName: string
  description?: string
  /** Delete the workspace. Receives the (already name-matched) confirmation text; throw
   *  to surface an error and keep the form open. */
  onDelete: (confirmName: string) => Promise<void>
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canDelete = confirmName.trim() === workspaceName

  const doDelete = async (): Promise<void> => {
    if (!canDelete || busy) return
    setBusy(true)
    setError(null)
    try {
      await onDelete(confirmName.trim())
    } catch (err) {
      setError(errorMessage(err, 'Could not delete'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 rounded-xl border border-destructive/30 p-4">
      <p className="text-sm font-medium">Delete this workspace</p>
      <p className="text-sm text-muted-foreground">{description}</p>
      {confirming ? (
        <div className="mt-1 grid gap-2">
          <label htmlFor="ws-confirm-delete" className="text-sm text-muted-foreground">
            Type <span className="font-semibold text-foreground">{workspaceName}</span> to confirm
          </label>
          <Input
            id="ws-confirm-delete"
            autoFocus
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            placeholder={workspaceName}
            disabled={busy}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !canDelete}
              onClick={() => void doDelete()}
              className="gap-1.5"
            >
              {busy ? null : <Trash className="size-4" />}
              <BusyLabel busy={busy} busyText="Deleting…" idle="Delete workspace" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                setConfirmName('')
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-fit gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash className="size-4" />
          Delete workspace
        </Button>
      )}
    </div>
  )
}
