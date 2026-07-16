import { useMemo } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { Scribble } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { formatTimestamp } from '@renderer/lib/date-time'
import { initialsOf } from '@renderer/lib/initials'
import { messagePreview } from '@renderer/lib/message-preview'
import { useNow } from '@renderer/lib/use-now'
import { useUiStore } from '@renderer/store/ui-store'

/** This channel's threads, most recently active first — opened from the channel
 *  header, and shaped exactly like `PinnedMessagesDialog` (same dialog, reserved
 *  height, loading/empty states). Clicking a row opens it in the right panel.
 *  Threads are no longer listed in the sidebar; the header is the only entry point. */
export function ThreadsDialog({
  workspaceId,
  channelId,
  channelName,
  open,
  onOpenChange
}: {
  workspaceId: Id<'workspaces'>
  channelId: Id<'channels'>
  channelName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const threads = useQuery(api.threads.listByWorkspace, open ? { workspaceId } : 'skip')
  const openThread = useUiStore((state) => state.openThread)
  const now = useNow()

  const channelThreads = useMemo(
    () => (threads ?? []).filter((thread) => thread.channelId === channelId),
    [threads, channelId]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scribble className="size-4" weight="bold" />
            Threads
          </DialogTitle>
          <DialogDescription>Threads in #{channelName}.</DialogDescription>
        </DialogHeader>

        {/* `min-h-0` lets the scroller shrink; the reserved height sits on the inner
            wrapper so the dialog opens at one size whether loading, empty or full. */}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-72 flex-col">
            {threads === undefined ? (
              <LoadingBlock />
            ) : channelThreads.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
                <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Scribble className="size-5" />
                </span>
                <p className="text-sm font-medium">No threads yet</p>
                <p className="max-w-64 text-xs text-muted-foreground">
                  Start a thread on any message to keep side conversations tidy.
                </p>
              </div>
            ) : (
              <ul className="grid gap-1">
                {channelThreads.map((thread) => {
                  const preview = messagePreview(thread.rootBody)
                  return (
                    <li key={thread._id}>
                      <button
                        type="button"
                        title="Open thread"
                        onClick={() => {
                          onOpenChange(false)
                          openThread(thread._id)
                        }}
                        className="flex w-full flex-col gap-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                            {thread.name}
                          </span>
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

                        <span className="text-[11px] font-medium text-primary">
                          {thread.replyCount === 0
                            ? 'No replies'
                            : `${thread.replyCount} ${thread.replyCount === 1 ? 'reply' : 'replies'}`}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
