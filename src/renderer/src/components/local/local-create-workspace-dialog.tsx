import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { useLocalStore } from '@renderer/store/local-store'

/** Create-workspace dialog for OFFLINE workspaces — the same dialog as the online
 *  `CreateWorkspaceDialog` (title, name field, footer), minus the online-only
 *  Address/slug field (offline workspaces have no URL). Used by the offline
 *  switcher + the first-run screen. */
export function LocalCreateWorkspaceDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const createWorkspace = useLocalStore((state) => state.createWorkspace)
  const navigate = useNavigate()

  const canSubmit = name.trim().length >= 2

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    createWorkspace(name.trim())
    onOpenChange(false)
    setName('')
    void navigate({ to: '/local' })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>
            An offline workspace lives in its own folder on this device — no account needed.
          </DialogDescription>
        </DialogHeader>
        <form id="create-local-workspace-form" onSubmit={submit} className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="local-ws-name">Workspace name</Label>
            <Input
              id="local-ws-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Inc."
              maxLength={60}
            />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-local-workspace-form" disabled={!canSubmit}>
            Create workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
