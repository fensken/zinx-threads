import { useCallback, useMemo, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { useUploadFile } from '@convex-dev/r2/react'
import { toast } from 'sonner'
import type { StickToBottomContext } from 'use-stick-to-bottom'
import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { Spinner } from '@renderer/components/ui/spinner'
import { ChannelIntro } from '@renderer/components/chat/channel-intro'
import { ChannelComposer } from '@renderer/components/chat/channel-composer'
import { ReadOnlyNotice } from '@renderer/components/chat/read-only-notice'
import {
  Conversation,
  ConversationContent,
  ConversationLoading,
  ConversationScrollback,
  ConversationScrollButton
} from '@renderer/components/chat/conversation'
import { CreateThreadDialog, type ThreadSeed } from '@renderer/components/chat/create-thread-dialog'
import { MarkChannelRead } from '@renderer/components/chat/mark-channel-read'
import { DayDivider, MessageRow } from '@renderer/components/chat/message-row'
import { PinnedMessagesDialog } from '@renderer/components/chat/pinned-messages-dialog'
import type { ReplyTargetMessage } from '@renderer/components/chat/reply-target'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { errorMessage } from '@renderer/lib/convex-error'
import { buildMessageRows } from '@renderer/lib/message-rows'
import { useChannelScrollback } from '@renderer/lib/use-channel-scrollback'
import { toggleLocalReaction } from '@renderer/lib/optimistic-reactions'
import { mergePending, pendingRows } from '@renderer/lib/pending-messages'
import { useNow } from '@renderer/lib/use-now'
import { useOutboxStore, type OutboxAttachment } from '@renderer/store/outbox-store'
import { useUiStore } from '@renderer/store/ui-store'

/** A pending row has no live affordances, but `MessageRow` requires the handlers. */
const NOOP = (): void => {}

/** Convex-backed chat content (real workspaces), mirroring `_zinx`'s chat: live
 *  message list grouped by author + day, hover actions (copy · react · reply ·
 *  thread · edit · ⋯ pin/delete), reaction pills, inline reply quotes with
 *  jump-to-message, pinned / "replied to you" / "mentioned you" highlights, an
 *  "(edited)" marker, thread indicators, and the Slack-style `ChannelComposer`
 *  pinned to the bottom. */
export function RealChannelView({
  channel,
  canModerate,
  canPost = true,
  allowThreads = true,
  displayName
}: {
  channel: Doc<'channels'>
  /** Workspace owner/admin — may delete anyone's message and pin. */
  canModerate: boolean
  /** May the reader WRITE here? False in an announcement channel, and in a
   *  `postingPolicy: 'selected'` channel for anyone who isn't a named talker. The server
   *  decides this (`getChannelAccess`); we only render it — so the composer, the reply
   *  button and the start-a-thread button all disappear together rather than offering
   *  three routes to the same rejection. */
  canPost?: boolean
  /** False in a DM: a thread is visible to the whole workspace (the header dialog,
   *  the palette, the sidebar counts all query threads workspace-wide), so one
   *  inside a private conversation would leak it. `threads.create` refuses a DM for
   *  the same reason — this just hides the affordance rather than offering a button
   *  that always errors. */
  allowThreads?: boolean
  /** What the composer calls this conversation ("Message Alice"). Defaults to the
   *  channel name; a DM passes the participants, since its name is an internal key. */
  displayName?: string
}): React.JSX.Element {
  const id = channel._id

  /** Captures `use-stick-to-bottom`'s context so we can reach the scroll element
   *  from outside the `<Conversation>` subtree (mirrors `_zinx`'s ref capture). */
  const conversation = useRef<StickToBottomContext | null>(null)

  // Growing reactive window — the newest page, widened as you scroll up.
  const {
    messages: messagesData,
    loading,
    loadingOlder,
    hasMore,
    loadOlder
  } = useChannelScrollback(id, conversation)

  const editMessage = useMutation(api.messages.edit)
  const removeMessage = useMutation(api.messages.remove)
  const togglePin = useMutation(api.messages.togglePin)

  // The pill flips on the click. Convex rolls this back when the real result lands.
  // Update *every* cached window for this channel (limit 50, 100, …) so the flip
  // shows regardless of how far the reader has scrolled back.
  const toggleReaction = useMutation(api.messages.toggleReaction).withOptimisticUpdate(
    (store, { messageId, emoji }) => {
      for (const { args, value } of store.getAllQueries(api.messages.listByChannel)) {
        if (!value || args.channelId !== id) continue
        store.setQuery(
          api.messages.listByChannel,
          args,
          value.map((message) =>
            message._id === messageId
              ? { ...message, reactions: toggleLocalReaction(message.reactions, emoji) }
              : message
          )
        )
      }
    }
  )

  // Sends go through the durable outbox (`OutboxFlusher` drains it), so a message
  // typed offline survives both the disconnect and an app quit.
  const enqueue = useOutboxStore((state) => state.enqueue)
  const uploadFile = useUploadFile(api.files)
  const deleteUpload = useMutation(api.files.deleteUpload)
  const outbox = useOutboxStore((state) => state.entries)
  const retryPending = useOutboxStore((state) => state.retry)
  const discardPending = useOutboxStore((state) => state.discard)
  const directory = useWorkspaceDirectory()
  const me = directory?.members.find((member) => member.isMe)
  const pinnedOpen = useUiStore((state) => state.pinnedOpen)
  const setPinnedOpen = useUiStore((state) => state.setPinnedOpen)
  const openThread = useUiStore((state) => state.openThread)
  // Ticks, so "Now" / "5m" stay accurate without a remount.
  const now = useNow()

  const [editingId, setEditingId] = useState<Id<'messages'> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<'messages'>
    hasThread: boolean
  } | null>(null)
  const [replyTarget, setReplyTarget] = useState<ReplyTargetMessage | null>(null)
  const [threadSeed, setThreadSeed] = useState<ThreadSeed | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  /** Surface Convex errors instead of swallowing the rejection. */
  const guard = useCallback(async (action: Promise<unknown>, fallback: string): Promise<void> => {
    try {
      await action
    } catch (error) {
      toast.error(errorMessage(error, fallback))
    }
  }, [])

  /** Close the editor only once the save lands, and **rethrow** so `ChatComposer`
   *  puts the draft back. Clearing `editingId` first unmounts the editor, and
   *  swallowing the rejection (as `guard` does) means its `.catch` never fires —
   *  either one silently throws away what the user just typed. */
  const saveEdit = useCallback(
    async (messageId: Id<'messages'>, body: string): Promise<void> => {
      try {
        await editMessage({ messageId, body })
        setEditingId(null)
      } catch (error) {
        toast.error(errorMessage(error, 'Could not save the message'))
        throw error
      }
    },
    [editMessage]
  )

  /** Scroll a message into view and flash it. Only the newest page is loaded, so
   *  an older target genuinely isn't here — say so rather than doing nothing
   *  (`_zinx` toasts "Message not loaded" for the same reason). */
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

  /** Enqueue, don't send. This never throws and never blocks, so the composer
   *  clears immediately and the message appears as a pending row — the way
   *  Discord and Slack behave. Awaiting the mutation here was actively harmful:
   *  offline, Convex neither resolves nor rejects it, so the draft-restore never
   *  fired and the text simply vanished. */
  const submit = (body: string, attachments?: OutboxAttachment[]): void => {
    enqueue({
      clientId: crypto.randomUUID(),
      channelId: id,
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
        channelId: id,
        serverMessages: messagesData,
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
    [outbox, id, messagesData, me]
  )

  // Delivered + unsent, folded into one grouped list: a message you just typed
  // groups under the header above it, and stops grouping at the same cap, so it
  // doesn't re-flow when the server acknowledges it.
  const { messages, entryFor } = useMemo(
    () => mergePending(messagesData, pending),
    [messagesData, pending]
  )
  const rows = useMemo(() => buildMessageRows(messages), [messages])

  /** The newest *delivered* message — the read marker we can honestly claim. */
  const newestAt = messagesData?.length ? messagesData[messagesData.length - 1].createdAt : 0

  return (
    // `min-h-0` lets the conversation scroll instead of stretching this column
    // (a flex item defaults to `min-height: auto`, which would push the composer
    // out of view once the messages overflow).
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {loading ? (
        <ConversationLoading />
      ) : (
        <Conversation contextRef={conversation}>
          <ConversationContent>
            {/* Infinite scrollback — grows the window as you near the top. */}
            <ConversationScrollback enabled={hasMore && !loadingOlder} onLoadOlder={loadOlder} />
            {loadingOlder ? (
              <div className="flex justify-center py-2">
                <Spinner className="size-4 text-muted-foreground" />
              </div>
            ) : null}
            {/* Discord-style "start of channel" block — only once the full history
                is loaded (`!hasMore`), so we never claim "the start" above older
                messages that haven't been fetched yet. Covers the empty channel too. */}
            {!hasMore ? (
              <ChannelIntro
                // A DM's `channel.name` is an internal `dm-<ids>` key — never render it.
                // The DM passes the participants' title as `displayName`; fall back gently.
                name={channel.kind === 'dm' ? (displayName ?? 'this conversation') : channel.name}
                kind={channel.kind}
                topic={channel.topic}
                isDm={channel.kind === 'dm'}
              />
            ) : null}
            {rows.map((row) => {
              if (row.type === 'day') return <DayDivider key={row.key} at={row.at} now={now} />

              // Unsent rows sit in the same list, so they group like any other
              // message — but they carry no live affordances.
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
                  thread={row.message.thread}
                  highlighted={highlightId === row.message._id}
                  editing={editingId === row.message._id}
                  onStartEdit={() => setEditingId(row.message._id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={(body) => saveEdit(row.message._id, body)}
                  onDelete={() =>
                    setDeleteTarget({
                      id: row.message._id,
                      hasThread: Boolean(row.message.thread)
                    })
                  }
                  onReact={(emoji) =>
                    void guard(
                      toggleReaction({ messageId: row.message._id, emoji }),
                      'Could not react'
                    )
                  }
                  onPin={() =>
                    void guard(togglePin({ messageId: row.message._id }), 'Could not pin')
                  }
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
                  onJump={jumpToMessage}
                  {...(allowThreads
                    ? {
                        // Opening an existing thread is *reading* — always allowed.
                        // Starting one is writing, so it goes with the composer.
                        onOpenThread: openThread,
                        ...(canPost
                          ? {
                              onCreateThread: () =>
                                setThreadSeed({
                                  messageId: row.message._id,
                                  body: row.message.body
                                })
                            }
                          : {})
                      }
                    : {})}
                />
              )
            })}
          </ConversationContent>
          <ConversationScrollButton messages={messagesData ?? []} />
          {/* Inside `<Conversation>` because it reads `isAtBottom`. Renders nothing.
              `messagesData`, not the merged list — an unsent message of your own
              has no server timestamp to mark read up to. */}
          <MarkChannelRead channelId={id} newestAt={newestAt} />
        </Conversation>
      )}

      {!canPost ? (
        <ReadOnlyNotice postingPolicy={channel.postingPolicy} />
      ) : (
        <ChannelComposer
          key={id}
          channelName={channel.name}
          // A DM has no `#name` — it's people. "Message Alice", not "Message #dm-…".
          placeholder={displayName ? `Message ${displayName}` : undefined}
          onSend={submit}
          onUpload={uploadFile}
          onRemoveUpload={(key) => void deleteUpload({ key })}
          replyTo={replyTarget}
          onCancelReply={() => setReplyTarget(null)}
        />
      )}

      <CreateThreadDialog
        seed={threadSeed}
        onOpenChange={(open) => !open && setThreadSeed(null)}
        onCreated={openThread}
      />

      <PinnedMessagesDialog
        channelId={id}
        channelName={channel.name}
        open={pinnedOpen}
        onOpenChange={setPinnedOpen}
        onJump={jumpToMessage}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete message?"
        description={
          deleteTarget?.hasThread ? (
            <>
              This message starts a thread.{' '}
              <span className="font-medium text-foreground">
                The thread and all of its replies will also be deleted.
              </span>{' '}
              This can&apos;t be undone.
            </>
          ) : (
            "This permanently removes the message and its reactions. This can't be undone."
          )
        }
        confirmLabel="Delete message"
        onConfirm={async () => {
          if (deleteTarget) await removeMessage({ messageId: deleteTarget.id })
        }}
      />
    </div>
  )
}
