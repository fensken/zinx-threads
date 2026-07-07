import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ChatsCircle, Plus } from '@phosphor-icons/react'
import { currentUser, getChannel, getMember, getServer, getThread } from '@renderer/data/workspaces'
import { MessageItem } from './message-item'

/** A thread opened as its own full-width page (route `/w/$workspaceId/t/$threadId`). */
export function ThreadView({
  serverId,
  threadId
}: {
  serverId: string
  threadId: string
}): React.JSX.Element {
  const navigate = useNavigate()
  const thread = getThread(threadId)

  if (!thread) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-muted-foreground">
        Thread not found.
      </div>
    )
  }

  const channel = getChannel(serverId, thread.channelId)
  const server = getServer(serverId)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          title="Back to channel"
          aria-label="Back to channel"
          onClick={() =>
            navigate({
              to: '/w/$workspaceId/c/$channelId',
              params: { workspaceId: serverId, channelId: thread.channelId }
            })
          }
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </button>
        <ChatsCircle className="size-5 shrink-0 text-muted-foreground" />
        <span className="truncate font-semibold">{thread.name}</span>
        <span className="hidden truncate text-sm text-muted-foreground md:block">
          {server?.name} › #{channel?.name ?? thread.channelId}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto py-4">
        <MessageItem
          message={thread.root}
          author={getMember(serverId, thread.root.authorId) ?? currentUser}
          grouped={false}
        />
        <div className="my-4 flex items-center gap-2 px-4">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">{thread.replies.length} replies</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        {thread.replies.map((reply) => (
          <MessageItem
            key={reply.id}
            message={reply}
            author={getMember(serverId, reply.authorId) ?? currentUser}
            grouped={false}
          />
        ))}
      </div>

      <ThreadComposer name={thread.name} />
    </div>
  )
}

function ThreadComposer({ name }: { name: string }): React.JSX.Element {
  const [value, setValue] = useState('')
  return (
    <div className="shrink-0 px-4 pt-1 pb-2">
      <div className="flex items-end gap-2 rounded-lg bg-muted px-3">
        <button
          type="button"
          title="Upload a file"
          aria-label="Upload a file"
          className="my-2.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground/70 text-background hover:bg-foreground"
        >
          <Plus className="size-4" weight="bold" />
        </button>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={1}
          placeholder={`Message ${name}`}
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}
