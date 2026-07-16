import { useState } from 'react'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { WifiSlash } from '@phosphor-icons/react'
import { useLocalStore } from '@renderer/store/local-store'
import { Button } from '@renderer/components/ui/button'
import { LocalCreateWorkspaceDialog } from '@renderer/components/local/local-create-workspace-dialog'

export const Route = createFileRoute('/local/')({
  component: LocalIndex
})

/** `/local` landing: first-run (name your first offline workspace), else jump to the
 *  current workspace's first channel, else an empty state. */
function LocalIndex(): React.JSX.Element {
  const hasWorkspaces = useLocalStore((state) => state.workspaces.length > 0)
  // First channel of the active workspace (ungrouped first, then by order).
  const firstChannelId = useLocalStore(
    (state) =>
      [...state.channels]
        .filter((c) => c.workspaceId === state.currentWorkspaceId)
        .sort((a, b) => (a.groupId ? 1 : 0) - (b.groupId ? 1 : 0) || a.order - b.order)[0]?.id
  )

  if (!hasWorkspaces) return <FirstRun />

  if (firstChannelId) {
    return <Navigate to="/local/$channelId" params={{ channelId: firstChannelId }} replace />
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      <WifiSlash className="size-10" />
      <p className="text-lg font-semibold text-foreground">Nothing here yet</p>
      <p className="max-w-sm text-sm">
        Create a page or board from the sidebar. Everything is saved on this device and works with
        no account or internet connection.
      </p>
    </div>
  )
}

/** Shown once, when there are no offline workspaces — opens the same
 *  create-workspace dialog the switcher (and the online onboarding) uses. */
function FirstRun(): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-warning/15 text-warning shadow-lg">
          <WifiSlash className="size-7" weight="bold" />
        </span>
        <div>
          <h1 className="text-xl font-bold">Create an offline workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A private space on this device for pages and boards — no account, works offline.
          </p>
        </div>
        <Button className="min-w-40" onClick={() => setCreateOpen(true)}>
          Create workspace
        </Button>
      </div>

      <LocalCreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
