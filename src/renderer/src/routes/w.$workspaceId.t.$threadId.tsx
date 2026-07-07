import { createFileRoute } from '@tanstack/react-router'
import { ThreadView } from '@renderer/components/app-shell/thread-view'

export const Route = createFileRoute('/w/$workspaceId/t/$threadId')({
  component: ThreadPage
})

function ThreadPage(): React.JSX.Element {
  const { workspaceId, threadId } = Route.useParams()
  return <ThreadView key={threadId} serverId={workspaceId} threadId={threadId} />
}
