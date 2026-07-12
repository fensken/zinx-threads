import { createFileRoute } from '@tanstack/react-router'
import type { Id } from '@convex/_generated/dataModel'
import { RealThreadPage } from '@renderer/components/chat/real-thread-page'

export const Route = createFileRoute('/w/$workspaceId/t/$threadId')({
  component: ThreadPage
})

function ThreadPage(): React.JSX.Element {
  const { workspaceId, threadId } = Route.useParams()
  return (
    <RealThreadPage
      key={threadId}
      workspaceSlug={workspaceId}
      threadId={threadId as Id<'threads'>}
    />
  )
}
