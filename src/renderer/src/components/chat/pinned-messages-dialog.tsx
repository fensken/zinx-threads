import { useQuery } from 'convex-helpers/react/cache/hooks'
import { PushPin } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar } from '@renderer/components/common/avatar'
import { MarkdownMessage } from '@renderer/components/chat/markdown-message'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { LoadingBlock } from '@renderer/components/common/loading-block'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
function timeOf(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/** Pinned messages for a channel (mirrors `_zinx`'s `PinnedMessagesDialog`).
 *  Read straight off the `by_channel_pinned` index. */
export function PinnedMessagesDialog({
  channelId,
  channelName,
  open,
  onOpenChange,
  onJump
}: {
  channelId: Id<'channels'>
  channelName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Closes the dialog and scrolls the message into view (mirrors `_zinx`). */
  onJump: (messageId: string) => void
}): React.JSX.Element {
  const pinned = useQuery(api.messages.listPinned, open ? { channelId } : 'skip')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PushPin className="size-4" weight="fill" />
            Pinned messages
          </DialogTitle>
          <DialogDescription>Messages pinned in #{channelName}.</DialogDescription>
        </DialogHeader>

        {/* `min-h-0` on the scroller is what lets it shrink and scroll; the
            reserved height goes on the inner wrapper, so the dialog opens at one
            size whether it's loading, empty or full. */}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-72 flex-col">
            {pinned === undefined ? (
              <LoadingBlock />
            ) : pinned.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
                <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <PushPin className="size-5" />
                </span>
                <p className="text-sm font-medium">Nothing pinned yet</p>
                <p className="max-w-64 text-xs text-muted-foreground">
                  Owners and admins can pin an important message from its ⋯ menu.
                </p>
              </div>
            ) : (
              <ul className="grid gap-1">
                {pinned.map((message) => {
                  const name = message.author?.name ?? 'Unknown'
                  return (
                    <li key={message._id}>
                      <button
                        type="button"
                        title="Jump to message"
                        onClick={() => {
                          onOpenChange(false)
                          onJump(message._id)
                        }}
                        className="flex w-full gap-3 rounded-lg px-1 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <Avatar
                          initials={initialsOf(name)}
                          color={message.author?.color ?? '#5865f2'}
                          image={message.author?.avatarUrl}
                          className="mt-0.5 size-8 text-xs"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold">{name}</span>
                            <span className="text-xs text-muted-foreground">
                              {timeOf(message.createdAt)}
                            </span>
                          </div>
                          <MarkdownMessage
                            content={message.body}
                            edited={Boolean(message.editedAt)}
                          />
                        </div>
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
