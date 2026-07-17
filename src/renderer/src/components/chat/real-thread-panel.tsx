import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useUploadFile } from '@convex-dev/r2/react'
import type { FunctionReturnType } from 'convex/server'
import { toast } from 'sonner'
import type { StickToBottomContext } from 'use-stick-to-bottom'
import { Scribble, CornersOut, DotsThreeOutline, Trash, X } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { IconButton } from '@renderer/components/common/icon-button'
import { ChannelComposer } from '@renderer/components/chat/channel-composer'
import { ReadOnlyNotice } from '@renderer/components/chat/read-only-notice'
import {
  Conversation,
  ConversationContent,
  ConversationLoading,
  ConversationScrollButton
} from '@renderer/components/chat/conversation'
import { DayDivider, MessageRow } from '@renderer/components/chat/message-row'
import type { ReplyTargetMessage } from '@renderer/components/chat/reply-target'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Spinner } from '@renderer/components/ui/spinner'
import { errorMessage } from '@renderer/lib/convex-error'
import { buildMessageRows } from '@renderer/lib/message-rows'
import { toggleLocalReaction } from '@renderer/lib/optimistic-reactions'
import { mergePending, pendingRows } from '@renderer/lib/pending-messages'
import { useNow } from '@renderer/lib/use-now'
import { useOutboxStore, type OutboxAttachment } from '@renderer/store/outbox-store'
import { useUiStore } from '@renderer/store/ui-store'

/** A pending row has no live affordances, but `MessageRow` requires the handlers. */
const NOOP = (): void => {}

type ThreadDetail = NonNullable<FunctionReturnType<typeof api.threads.get>>

/** The `MessageRow` callbacks the root and every reply share. */
interface RowHandlers {
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (body: string) => Promise<void>
  onDelete: () => void
  onReact: (emoji: string) => void
  onPin: () => void
  onJump: (messageId: string) => void
}

/** A thread in the right panel: the root message, a "N replies" divider, the
 *  replies, and a composer. Ported from the demo's `ThreadPanel`.
 *
 *  The root is an ordinary channel message rendered with the shared `MessageRow`,
 *  minus the thread affordances (no `onOpenThread`/`onCreateThread`) — that's how
 *  "threads don't nest" is enforced in the UI, matching the server's refusal. */
export function RealThreadPanel({
  workspaceSlug,
  threadId
}: {
  workspaceSlug: string
  threadId: Id<'threads'>
}): React.JSX.Element {
  const navigate = useNavigate()
  const closeThread = useUiStore((state) => state.closeThread)
  const thread = useQuery(api.threads.get, { threadId })

  if (thread === undefined) {
    return (
      <aside className="flex h-full w-full items-center justify-center bg-card">
        <Spinner className="size-6 text-muted-foreground" />
      </aside>
    )
  }

  // Deleted out from under us (or we lost access) — don't strand the panel.
  if (thread === null) {
    return (
      <aside className="flex h-full w-full flex-col items-center justify-center gap-2 bg-card text-muted-foreground">
        <p className="text-sm">This thread no longer exists.</p>
        <Button variant="ghost" size="sm" onClick={closeThread}>
          Close
        </Button>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-full min-w-0 flex-col bg-card">
      <ThreadHeader
        threadId={threadId}
        name={thread.name}
        channelName={thread.channelName}
        canManage={thread.canManage}
        onClose={closeThread}
        onExpand={() => {
          void navigate({
            to: '/w/$workspaceId/t/$threadId',
            params: { workspaceId: workspaceSlug, threadId }
          })
          closeThread()
        }}
      />
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
    </aside>
  )
}

function ThreadHeader({
  threadId,
  name,
  channelName,
  canManage,
  onClose,
  onExpand
}: {
  threadId: Id<'threads'>
  name: string
  channelName: string
  canManage: boolean
  onClose: () => void
  onExpand?: () => void
}): React.JSX.Element {
  const removeThread = useMutation(api.threads.remove)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 shadow-sm">
      <Scribble className="size-5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="truncate text-xs text-muted-foreground">in #{channelName}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {canManage ? (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              title="Thread options"
              aria-label="Thread options"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <DotsThreeOutline className="size-4" weight="fill" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  setMenuOpen(false)
                  setConfirmDelete(true)
                }}
              >
                <Trash className="size-4" />
                Delete thread
              </Button>
            </PopoverContent>
          </Popover>
        ) : null}

        {onExpand ? (
          <IconButton label="Open as full page" onClick={onExpand}>
            <CornersOut className="size-5" />
          </IconButton>
        ) : null}
        <IconButton label="Close thread" onClick={onClose}>
          <X className="size-5" />
        </IconButton>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete thread?"
        description="This permanently removes the thread and every reply in it. The original message stays in the channel. This can't be undone."
        confirmLabel="Delete thread"
        onConfirm={async () => {
          await removeThread({ threadId })
          onClose()
        }}
      />
    </header>
  )
}

/** Root + replies + composer. Split out so the full-page thread route can reuse
 *  it under a different header. */
export function ThreadConversation({
  threadId,
  channelId,
  root,
  name,
  replyCount,
  canModerate,
  canPost,
  postingPolicy
}: {
  threadId: Id<'threads'>
  channelId: Id<'channels'>
  root: ThreadDetail['root']
  name: string
  replyCount: number
  canModerate: boolean
  /** A thread inherits its channel's posting policy — see `threads.get`. */
  canPost: boolean
  postingPolicy?: 'everyone' | 'admins' | 'selected'
}): React.JSX.Element {
  const replies = useQuery(api.threads.listMessages, { threadId })
  const editMessage = useMutation(api.messages.edit)
  const removeMessage = useMutation(api.messages.remove)
  const togglePin = useMutation(api.messages.togglePin)
  const now = useNow()

  const toggleReaction = useMutation(api.messages.toggleReaction).withOptimisticUpdate(
    (store, { messageId, emoji }) => {
      const current = store.getQuery(api.threads.listMessages, { threadId })
      if (!current) return
      store.setQuery(
        api.threads.listMessages,
        { threadId },
        current.map((message) =>
          message._id === messageId
            ? { ...message, reactions: toggleLocalReaction(message.reactions, emoji) }
            : message
        )
      )
    }
  )

  const enqueue = useOutboxStore((state) => state.enqueue)
  const uploadFile = useUploadFile(api.files)
  const deleteUpload = useMutation(api.files.deleteUpload)
  const outbox = useOutboxStore((state) => state.entries)
  const retryPending = useOutboxStore((state) => state.retry)
  const discardPending = useOutboxStore((state) => state.discard)
  const directory = useWorkspaceDirectory()
  const me = directory?.members.find((member) => member.isMe)

  const closeThread = useUiStore((state) => state.closeThread)
  const conversation = useRef<StickToBottomContext | null>(null)
  const [editingId, setEditingId] = useState<Id<'messages'> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<'messages'>
    isRoot: boolean
  } | null>(null)
  const [replyTarget, setReplyTarget] = useState<ReplyTargetMessage | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const guard = useCallback(async (action: Promise<unknown>, fallback: string): Promise<void> => {
    try {
      await action
    } catch (error) {
      toast.error(errorMessage(error, fallback))
    }
  }, [])

  const jumpToMessage = useCallback((messageId: string) => {
    const container = conversation.current?.scrollRef.current
    const target = container?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
    if (!target) {
      toast.info('That message isn’t loaded — scroll up to find it.')
      return
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(messageId)
    setTimeout(() => setHighlightId((current) => (current === messageId ? null : current)), 1600)
  }, [])

  /** Enqueue, don't send — see `RealChannelView.submit`. The `OutboxFlusher`
   *  delivers it, so a reply typed offline survives a disconnect and an app quit. */
  const submit = (body: string, attachments?: OutboxAttachment[]): void => {
    enqueue({
      clientId: crypto.randomUUID(),
      channelId,
      threadId,
      body,
      attachments,
      replyToId: replyTarget?._id,
      replyToAuthorName: replyTarget?.authorName,
      createdAt: Date.now()
    })
    setReplyTarget(null)
  }

  const pending = useMemo(
    () =>
      pendingRows({
        entries: outbox,
        channelId,
        threadId,
        serverMessages: replies,
        author: me && {
          userId: me.userId,
          name: me.name,
          color: me.color,
          avatarUrl: me.avatarUrl,
          presence: me.presence,
          statusEmoji: me.statusEmoji,
          statusText: me.statusText
        }
      }),
    [outbox, channelId, threadId, replies, me]
  )

  // One list, so an unsent reply groups with the delivered one above it and
  // counts toward the group-size cap — see `mergePending`.
  const { messages, entryFor } = useMemo(() => mergePending(replies, pending), [replies, pending])
  const rows = useMemo(() => buildMessageRows(messages), [messages])

  /** The root and every reply share these — no thread affordances, so a thread
   *  can't spawn a thread. */
  const handlers = (messageId: Id<'messages'>): RowHandlers => ({
    onStartEdit: () => setEditingId(messageId),
    onCancelEdit: () => setEditingId(null),
    // Close the editor only once the save lands, and rethrow so `ChatComposer`
    // restores the draft — clearing first, or swallowing via `guard`, loses it.
    onSaveEdit: async (body: string) => {
      try {
        await editMessage({ messageId, body })
        setEditingId(null)
      } catch (error) {
        toast.error(errorMessage(error, 'Could not save the message'))
        throw error
      }
    },
    onDelete: () => setDeleteTarget({ id: messageId, isRoot: messageId === root._id }),
    onReact: (emoji: string) => void guard(toggleReaction({ messageId, emoji }), 'Could not react'),
    onPin: () => void guard(togglePin({ messageId }), 'Could not pin'),
    // `jumpToMessage` reads the scroll-container ref only when a reply quote is
    // *clicked*, never during render.
    // eslint-disable-next-line react-hooks/refs
    onJump: jumpToMessage
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Mount the scroll region only once the replies are in. `Conversation`
          positions itself instantly on its *first* content measurement and animates
          every later one — so showing the root alone and letting the replies land
          afterwards would make the panel visibly scroll down on open, the exact
          thing we avoid in the channel. Swapped as a sibling (not an early return)
          so the composer below keeps its draft across the transition. */}
      {replies === undefined ? (
        <ConversationLoading />
      ) : (
        <Conversation contextRef={conversation}>
          <ConversationContent>
            <MessageRow
              message={root}
              grouped={false}
              now={now}
              canModerate={canModerate}
              highlighted={highlightId === root._id}
              editing={editingId === root._id}
              {...handlers(root._id)}
              onReply={
                canPost
                  ? () =>
                      setReplyTarget({
                        _id: root._id,
                        body: root.body,
                        authorName: root.author?.name ?? 'Unknown'
                      })
                  : undefined
              }
            />

            <div className="my-3 flex items-center gap-2 px-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">
                {replyCount === 0
                  ? 'No replies yet'
                  : `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {rows.map((row) => {
              if (row.type === 'day') return <DayDivider key={row.key} at={row.at} now={now} />

              const entry = entryFor(row.message._id)
              if (entry) {
                return (
                  <MessageRow
                    key={row.message._id}
                    message={row.message}
                    grouped={row.grouped}
                    now={now}
                    canModerate={false}
                    pending
                    failed={entry.error}
                    onRetry={() => retryPending(entry.clientId)}
                    onDiscard={() => discardPending(entry.clientId)}
                    highlighted={false}
                    editing={false}
                    onStartEdit={NOOP}
                    onCancelEdit={NOOP}
                    onSaveEdit={NOOP}
                    onDelete={NOOP}
                    onReact={NOOP}
                    onPin={NOOP}
                    onReply={NOOP}
                    onJump={NOOP}
                  />
                )
              }

              return (
                <MessageRow
                  key={row.message._id}
                  message={row.message}
                  grouped={row.grouped}
                  now={now}
                  canModerate={canModerate}
                  highlighted={highlightId === row.message._id}
                  editing={editingId === row.message._id}
                  {...handlers(row.message._id)}
                  onReply={
                    canPost
                      ? () =>
                          setReplyTarget({
                            _id: row.message._id,
                            body: row.message.body,
                            authorName: row.message.author?.name ?? 'Unknown'
                          })
                      : undefined
                  }
                />
              )
            })}
          </ConversationContent>
          <ConversationScrollButton messages={replies} />
        </Conversation>
      )}

      {canPost ? (
        <ChannelComposer
          key={threadId}
          channelName={name}
          placeholder={`Reply in ${name}`}
          onSend={submit}
          onUpload={uploadFile}
          onRemoveUpload={(key) => void deleteUpload({ key })}
          replyTo={replyTarget}
          onCancelReply={() => setReplyTarget(null)}
        />
      ) : (
        <ReadOnlyNotice postingPolicy={postingPolicy} />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget?.isRoot ? 'Delete this thread?' : 'Delete message?'}
        description={
          deleteTarget?.isRoot ? (
            <>
              This is the message the thread started from.{' '}
              <span className="font-medium text-foreground">
                The whole thread and all of its replies will be deleted.
              </span>{' '}
              This can&apos;t be undone.
            </>
          ) : (
            "This permanently removes the message and its reactions. This can't be undone."
          )
        }
        confirmLabel={deleteTarget?.isRoot ? 'Delete thread' : 'Delete message'}
        onConfirm={async () => {
          if (!deleteTarget) return
          const wasRoot = deleteTarget.isRoot
          await removeMessage({ messageId: deleteTarget.id })
          // Deleting the root cascades the thread we're viewing — close the panel.
          if (wasRoot) closeThread()
        }}
      />
    </div>
  )
}
