import { useNavigate } from '@tanstack/react-router'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { ArrowLeft, Scribble } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { ThreadConversation } from '@renderer/components/chat/real-thread-panel'
import { IconButton } from '@renderer/components/common/icon-button'
import { Spinner } from '@renderer/components/ui/spinner'

/** A thread opened as its own page (`/w/$workspaceId/t/$threadId`), reusing the
 *  panel's `ThreadConversation` under a wider header with a breadcrumb back to
 *  the channel. */
export function RealThreadPage({
  workspaceSlug,
  threadId
}: {
  workspaceSlug: string
  threadId: Id<'threads'>
}): React.JSX.Element {
  const navigate = useNavigate()
  const thread = useQuery(api.threads.get, { threadId })

  if (thread === undefined) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center bg-card">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }
  if (thread === null) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center bg-card text-muted-foreground">
        This thread no longer exists.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <IconButton
          label="Back to channel"
          onClick={() =>
            void navigate({
              to: '/w/$workspaceId/$channelSlug',
              params: { workspaceId: workspaceSlug, channelSlug: thread.channelName }
            })
          }
        >
          <ArrowLeft className="size-5" />
        </IconButton>
        <Scribble className="size-5 shrink-0 text-muted-foreground" />
        <span className="truncate font-semibold">{thread.name}</span>
        <span className="mx-1 hidden h-4 w-px shrink-0 bg-border md:block" />
        <span className="hidden min-w-0 items-center gap-1 truncate text-sm text-muted-foreground md:flex">
          <ChannelKindIcon kind={thread.channelKind} className="size-4 shrink-0" />
          {thread.channelName}
        </span>
      </header>

      <ThreadConversation
        threadId={threadId}
        channelId={thread.channelId}
        root={thread.root}
        name={thread.name}
        replyCount={thread.replyCount}
        canModerate={thread.canModerate}
        canPost={thread.canPost}
        postingPolicy={thread.postingPolicy}
      />
    </div>
  )
}
