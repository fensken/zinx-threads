import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useLocalStore } from '@renderer/store/local-store'
import { LocalChannelView } from '@renderer/components/local/local-channel-view'

export const Route = createFileRoute('/local/$channelId')({
  component: LocalChannelRoute
})

function LocalChannelRoute(): React.JSX.Element {
  const { channelId } = Route.useParams()
  const channel = useLocalStore((state) => state.channels.find((entry) => entry.id === channelId))
  const currentWorkspaceId = useLocalStore((state) => state.currentWorkspaceId)
  const setCurrentWorkspace = useLocalStore((state) => state.setCurrentWorkspace)

  // Landing on a channel directly (reload / a link) makes its workspace the active one,
  // so the sidebar shows the right workspace.
  useEffect(() => {
    if (channel && channel.workspaceId !== currentWorkspaceId) {
      setCurrentWorkspace(channel.workspaceId)
    }
  }, [channel, currentWorkspaceId, setCurrentWorkspace])

  if (!channel) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-muted-foreground">
        This item was deleted.
      </div>
    )
  }
  return <LocalChannelView channel={channel} />
}
