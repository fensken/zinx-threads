import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CreateWorkspaceDialogView } from '@renderer/components/workspace/create-workspace-dialog'
import { useLocalStore } from '@renderer/store/local-store'

/** Create a local workspace — renders the **same** `CreateWorkspaceDialogView` as the
 *  online app, with no online-only fields (a local workspace has no URL address or team
 *  timezone). Same UI, no fork. Used by the local switcher + the first-run screen. */
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

  return (
    <CreateWorkspaceDialogView
      open={open}
      onOpenChange={onOpenChange}
      description="A local workspace lives in its own folder on this device — no account needed."
      name={name}
      onNameChange={setName}
      canSubmit={name.trim().length >= 2}
      onSubmit={() => {
        createWorkspace(name.trim())
        setName('')
        onOpenChange(false)
        void navigate({ to: '/local' })
      }}
    />
  )
}
