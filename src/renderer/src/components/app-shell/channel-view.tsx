import { lazy, Suspense, useEffect, useState } from 'react'
import {
  currentUser,
  getBoard,
  getChannel,
  getMember,
  getMessages,
  getPage,
  type Message
} from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'
import { useMediaQuery } from '@renderer/lib/use-media-query'
import { ChannelHeader } from './channel-header'
import { BoardView } from '../kanban/board-view'
import { MessageList } from './message-list'
import { MessageComposer } from './message-composer'
import { MemberList } from './member-list'
import { ThreadPanel } from './thread-panel'
import { ResizeHandle } from './resize-handle'

// The BlockNote editor (+ ProseMirror) is a large chunk — only load it for page channels.
const PageEditor = lazy(() =>
  import('./page-editor').then((module) => ({ default: module.PageEditor }))
)

export function ChannelView({
  serverId,
  channelId
}: {
  serverId: string
  channelId: string
}): React.JSX.Element {
  const channel = getChannel(serverId, channelId)
  const [messages, setMessages] = useState<Message[]>(() => getMessages(channelId))
  const activeThreadId = useUiStore((state) => state.activeThreadId)
  const memberListOpen = useUiStore((state) => state.memberListOpen)
  const replyingToId = useUiStore((state) => state.replyingToId)
  const rightWidth = useUiStore((state) => state.rightWidth)
  const threadWidth = useUiStore((state) => state.threadWidth)
  const isWide = useMediaQuery('(min-width: 1024px)')

  // Reset transient panels when the channel changes (this view is keyed by channelId).
  useEffect(() => {
    const ui = useUiStore.getState()
    ui.closeThread()
    ui.setReplyingTo(null)
  }, [channelId])

  if (!channel) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-muted-foreground">
        Channel not found.
      </div>
    )
  }

  const showRight = Boolean(activeThreadId) || memberListOpen
  const replyTarget = replyingToId ? messages.find((m) => m.id === replyingToId) : undefined
  const replyToName = replyTarget
    ? (getMember(serverId, replyTarget.authorId) ?? currentUser).name
    : null

  const handleSend = (body: string): void => {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), channelId, authorId: currentUser.id, time: 'Just now', body }
    ])
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ChannelHeader channel={channel} />
        {channel.kind === 'page' ? (
          <Suspense fallback={<div className="flex-1" />}>
            <PageEditor key={channelId} page={getPage(channelId)} />
          </Suspense>
        ) : channel.kind === 'kanban' ? (
          <BoardView key={channelId} board={getBoard(channelId)} serverId={serverId} />
        ) : (
          <>
            <MessageList channel={channel} serverId={serverId} messages={messages} />
            <MessageComposer channel={channel} replyToName={replyToName} onSend={handleSend} />
          </>
        )}
      </div>
      {isWide && showRight ? (
        <>
          <ResizeHandle
            onDelta={(dx) => {
              const ui = useUiStore.getState()
              if (ui.activeThreadId) ui.setThreadWidth(ui.threadWidth - dx)
              else ui.setRightWidth(ui.rightWidth - dx)
            }}
          />
          <div
            className="flex shrink-0 border-l border-border"
            style={{ width: activeThreadId ? threadWidth : rightWidth }}
          >
            {activeThreadId ? (
              <ThreadPanel serverId={serverId} threadId={activeThreadId} />
            ) : (
              <MemberList serverId={serverId} />
            )}
          </div>
        </>
      ) : null}

      {/* Compact (below lg): a thread opens as a right-side overlay; the member
          list is desktop-only (reachable by widening the window). */}
      {activeThreadId && !isWide ? (
        <>
          <button
            type="button"
            aria-label="Close thread"
            onClick={() => useUiStore.getState().closeThread()}
            className="fixed inset-0 z-30 bg-black/40"
          />
          <div className="fixed inset-y-0 right-0 z-40 flex w-[92vw] max-w-md border-l border-border bg-card shadow-2xl">
            <ThreadPanel serverId={serverId} threadId={activeThreadId} />
          </div>
        </>
      ) : null}
    </div>
  )
}
