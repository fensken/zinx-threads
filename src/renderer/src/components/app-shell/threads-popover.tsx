import { ChatsCircle, X } from '@phosphor-icons/react'
import { currentUser, getMember, getThreadsForServer, type Thread } from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'
import { Avatar } from './avatar'

export function ThreadsPopover({ serverId }: { serverId: string }): React.JSX.Element | null {
  const open = useUiStore((state) => state.threadsOpen)
  const setOpen = useUiStore((state) => state.setThreadsOpen)
  const openThread = useUiStore((state) => state.openThread)

  if (!open) return null
  const threads = getThreadsForServer(serverId)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      <div className="absolute top-full right-0 z-50 mt-2 flex max-h-[70dvh] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <ChatsCircle className="size-5" />
          <span className="font-semibold">Threads</span>
          <button
            type="button"
            aria-label="Close threads"
            onClick={() => setOpen(false)}
            className="ml-auto flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="no-scrollbar flex-1 overflow-y-auto p-2">
          {threads.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No active threads.</p>
          ) : (
            threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} onOpen={() => openThread(thread.id)} />
            ))
          )}
        </div>
      </div>
    </>
  )
}

function ThreadRow({ thread, onOpen }: { thread: Thread; onOpen: () => void }): React.JSX.Element {
  const author = getMember(thread.serverId, thread.root.authorId) ?? currentUser
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-1 rounded-md p-3 text-left transition-colors hover:bg-accent/60"
    >
      <span className="truncate font-semibold">{thread.name}</span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Avatar initials={author.initials} color={author.color} className="size-4" />
        <span className="truncate">{thread.root.body}</span>
      </span>
      <span className="text-xs font-medium text-primary">{thread.replies.length} replies</span>
    </button>
  )
}
