import { useQuery } from 'convex-helpers/react/cache/hooks'
import { ChatsCircle } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { NavEmptyState } from '@renderer/components/chat/nav-flyout'
import { formatTimestamp } from '@renderer/lib/date-time'
import { initialsOf } from '@renderer/lib/initials'
import { messagePreview } from '@renderer/lib/message-preview'
import { useNow } from '@renderer/lib/use-now'
import { useUiStore } from '@renderer/store/ui-store'

/** Every thread in the workspace, most recently active first — the contents of
 *  the "Threads" flyout (header + sidebar quick nav). Ported from the demo's
 *  `ThreadsPopover`; clicking a row opens it in the right panel. */
export function RealThreadsList({
  workspaceId
}: {
  workspaceId: Id<'workspaces'>
}): React.JSX.Element {
  const threads = useQuery(api.threads.listByWorkspace, { workspaceId })
  const openThread = useUiStore((state) => state.openThread)
  const now = useNow()

  if (threads === undefined) return <LoadingBlock />

  if (threads.length === 0) {
    return (
      <NavEmptyState
        icon={<ChatsCircle className="size-5" />}
        title="No threads yet"
        message="Start a thread on any message to keep side conversations tidy."
      />
    )
  }

  return (
    <div className="-mx-1 space-y-0.5">
      {threads.map((thread) => {
        const preview = messagePreview(thread.rootBody)
        return (
          <button
            key={thread._id}
            type="button"
            onClick={() => openThread(thread._id)}
            className="flex w-full flex-col gap-1 rounded-md p-2 text-left transition-colors hover:bg-accent/60"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{thread.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatTimestamp(thread.lastReplyAt, now)}
              </span>
            </span>

            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Avatar
                initials={initialsOf(thread.rootAuthorName)}
                color={thread.rootAuthorColor ?? FALLBACK_AVATAR_COLOR}
                image={thread.rootAuthorAvatarUrl}
                className="size-4 text-[8px]"
              />
              <span className="truncate">{preview.isGif ? 'GIF' : preview.text}</span>
            </span>

            <span className="flex items-center gap-2 text-[11px]">
              <span className="truncate text-muted-foreground">#{thread.channelName}</span>
              <span className="font-medium text-primary">
                {thread.replyCount === 0
                  ? 'No replies'
                  : `${thread.replyCount} ${thread.replyCount === 1 ? 'reply' : 'replies'}`}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
