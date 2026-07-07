import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChatsCircle, CornersOut, Plus, X } from '@phosphor-icons/react'
import { currentUser, getMember, getThread } from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'
import { IconButton } from './icon-button'
import { MessageItem } from './message-item'

export function ThreadPanel({
  serverId,
  threadId
}: {
  serverId: string
  threadId: string
}): React.JSX.Element {
  const closeThread = useUiStore((state) => state.closeThread)
  const navigate = useNavigate()
  const thread = getThread(threadId)

  if (!thread) {
    return (
      <aside className="flex h-full w-full flex-col items-center justify-center bg-card text-muted-foreground">
        Thread not found.
        <button type="button" className="mt-2 text-primary" onClick={closeThread}>
          Close
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-full flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 shadow-sm">
        <ChatsCircle className="size-5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-semibold">Thread</span>
        <span className="truncate text-sm text-muted-foreground">{thread.name}</span>
        <IconButton
          label="Open as full page"
          className="ml-auto"
          onClick={() => {
            navigate({
              to: '/w/$workspaceId/t/$threadId',
              params: { workspaceId: serverId, threadId }
            })
            closeThread()
          }}
        >
          <CornersOut className="size-5" />
        </IconButton>
        <IconButton label="Close thread" onClick={closeThread}>
          <X className="size-5" />
        </IconButton>
      </header>

      <div className="flex-1 overflow-y-auto py-3">
        <MessageItem
          message={thread.root}
          author={getMember(serverId, thread.root.authorId) ?? currentUser}
          grouped={false}
        />
        <div className="my-3 flex items-center gap-2 px-4">
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
    </aside>
  )
}

function ThreadComposer({ name }: { name: string }): React.JSX.Element {
  const [value, setValue] = useState('')
  return (
    <div className="shrink-0 px-4 pt-1 pb-4">
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
          className="max-h-32 min-h-11 flex-1 resize-none bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  )
}
