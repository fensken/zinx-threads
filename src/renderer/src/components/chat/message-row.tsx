import { useState } from 'react'
import type { FunctionReturnType } from 'convex/server'
import { PushPin, WarningCircle } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { AuthorRoleBadge } from '@renderer/components/chat/author-role-badge'
import { ChatComposer } from '@renderer/components/chat/chat-composer'
import { EditGifMessage } from '@renderer/components/chat/edit-gif-message'
import { MarkdownMessage } from '@renderer/components/chat/markdown-message'
import { MessageAttachments } from '@renderer/components/chat/message-attachments'
import { MessageActions } from '@renderer/components/chat/message-actions'
import { MessageReactions } from '@renderer/components/chat/message-reactions'
import { MessageReply } from '@renderer/components/chat/message-reply'
import { ThreadIndicator, type ThreadSummary } from '@renderer/components/chat/thread-indicator'
import { UserProfilePopover } from '@renderer/components/chat/user-profile-popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { formatDateSeparator, formatFullTimestamp, formatTimestamp } from '@renderer/lib/date-time'
import { initialsOf } from '@renderer/lib/initials'
import { stripMentionLinks } from '@renderer/lib/mention'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { gifSrc } from '@renderer/lib/message-preview'
import { presenceWithConnectivity } from '@renderer/lib/user-status'
import { useIsOnline } from '@renderer/store/presence-store'
import { cn } from '@renderer/lib/utils'

/** The enriched message shape shared by the channel list and a thread's replies —
 *  they're the same table and must render identically (`convex/lib/messages.ts`
 *  `enrichMessages`).
 *
 *  `thread` is optional because only `messages.listByChannel` resolves it (a
 *  thread reply can't itself start a thread). Declaring it here lets a channel
 *  message and a pending outbox row live in one array, which is what
 *  `buildMessageRows` needs to group them together. */
export type ChatMessage = FunctionReturnType<typeof api.threads.listMessages>[number] & {
  thread?: ThreadSummary | null
}

/** The compact time next to a message, with the exact time on hover (`_zinx`). */
export function MessageTime({
  at,
  now,
  className
}: {
  at: number
  now: Date
  className?: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('h-fit shrink-0 cursor-default text-xs text-muted-foreground', className)}
      >
        {formatTimestamp(at, now)}
      </TooltipTrigger>
      <TooltipContent>{formatFullTimestamp(at)}</TooltipContent>
    </Tooltip>
  )
}

export function DayDivider({ at, now }: { at: number; now: Date }): React.JSX.Element {
  return (
    <div className="my-3 flex items-center gap-2 px-4">
      <div className="flex-1 border-t" />
      <span className="rounded-full border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        {formatDateSeparator(at, now)}
      </span>
      <div className="flex-1 border-t" />
    </div>
  )
}

/** One message row: hover actions, avatar-or-hover-time gutter, header, body,
 *  reactions, and (in a channel) the thread indicator.
 *
 *  Thread affordances are opt-in: the panel omits `onOpenThread`/`onCreateThread`
 *  entirely, which is what enforces "no threads inside threads" in the UI. */
export function MessageRow({
  message,
  grouped,
  now,
  canModerate,
  highlighted,
  editing,
  thread,
  pending,
  failed,
  onRetry,
  onDiscard,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReact,
  onPin,
  onReply,
  onJump,
  onOpenThread,
  onCreateThread
}: {
  message: ChatMessage
  grouped: boolean
  now: Date
  canModerate: boolean
  highlighted: boolean
  editing: boolean
  /** The thread started from this message, if any. */
  thread?: ThreadSummary | null
  /** Sitting in the durable outbox, not yet acknowledged by the server. */
  pending?: boolean
  /** The server rejected it. Terminal — the row offers Retry / Delete. */
  failed?: string
  onRetry?: () => void
  onDiscard?: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: (body: string) => void | Promise<void>
  onDelete: () => void
  onReact: (emoji: string) => void
  onPin: () => void
  onReply?: () => void
  onJump: (messageId: string) => void
  onOpenThread?: (threadId: string) => void
  onCreateThread?: () => void
}): React.JSX.Element {
  const [reactOpen, setReactOpen] = useState(false)
  const name = message.author?.name ?? 'Unknown'
  // Grey dot when the author's app is disconnected, else their chosen status.
  const authorOnline = useIsOnline(message.authorId)
  const isPinned = Boolean(message.pinned)
  const repliedToMe = Boolean(message.replyTo?.authorIsMe) && !message.isAuthor
  const mentionsMe = Boolean(message.mentionsMe)
  const pingsMe = repliedToMe || mentionsMe

  /** Both the avatar and the name open the same profile card. */
  const profile = {
    userId: message.authorId,
    fallbackName: name,
    fallbackColor: message.author?.color ?? FALLBACK_AVATAR_COLOR,
    fallbackAvatarUrl: message.author?.avatarUrl
  }

  // Shared by both row shapes: inline in the header on a full row, on their own
  // line above the content on a grouped one.
  const indicators =
    isPinned || pingsMe ? (
      <>
        {isPinned ? (
          <span className="flex items-center gap-1 text-[11px] text-primary">
            <PushPin className="size-3" weight="fill" />
            Pinned
          </span>
        ) : null}
        {repliedToMe ? <span className="text-[11px] text-warning">Replied to you</span> : null}
        {mentionsMe && !repliedToMe ? (
          <span className="text-[11px] text-warning">Mentioned you</span>
        ) : null}
      </>
    ) : null

  if (editing) {
    // A message that *is* a GIF gets the "change the GIF" editor, not a text box
    // — you can't type a GIF. Same branch `_zinx` makes.
    const src = gifSrc(message.body)
    if (src) {
      return (
        <EditGifMessage
          src={src}
          onCancel={onCancelEdit}
          onSave={(url, kind) => void onSaveEdit(`![${kind}](${url})`)}
        />
      )
    }

    return (
      <div className="mx-2 px-2 py-1">
        <ChatComposer
          placeholder="Edit message"
          initialMarkdown={message.body}
          autoFocus
          onSubmit={onSaveEdit}
          onCancel={onCancelEdit}
        >
          <ChatComposer.Box variant="edit">
            <ChatComposer.Toolbar />
            <ChatComposer.Row>
              <ChatComposer.Editor />
              <ChatComposer.Actions>
                <ChatComposer.FormatToggle />
                <ChatComposer.Emoji />
                <ChatComposer.Cancel />
                <ChatComposer.Submit label="Save changes" />
              </ChatComposer.Actions>
            </ChatComposer.Row>
          </ChatComposer.Box>
        </ChatComposer>
      </div>
    )
  }

  return (
    <div
      data-message-id={message._id}
      className={cn(
        // `items-start`: the avatar and the hover-time gutter pin to the top of a
        // tall message rather than centring against it (`_zinx` does the same).
        'group relative mx-2 flex items-start gap-4 rounded-lg px-2 py-1 transition-colors hover:bg-muted/40',
        grouped ? '' : 'mt-3',
        // Pin outranks "replied to you" / "mentioned you", which outrank the flash.
        isPinned && 'border-l-2 border-l-primary bg-primary/5',
        !isPinned && pingsMe && 'border-l-2 border-l-warning bg-warning/10',
        highlighted && 'bg-primary/10 ring-1 ring-primary/40',
        // Unsent: dimmed like Discord/Slack. Nothing about it is actionable yet.
        pending && !failed && 'opacity-60'
      )}
    >
      {pending ? null : (
        <MessageActions
          isAuthor={message.isAuthor}
          // Deleting a message that roots a thread cascades the whole thread (the
          // delete confirm warns first) — so the button is offered; it no longer
          // just errors.
          canDelete={message.isAuthor || canModerate}
          canPin={canModerate}
          isPinned={isPinned}
          hasThread={Boolean(thread)}
          // Copy what the reader saw — mention links collapse to `@Alice`, never
          // `[@Alice](zinx://user/…)`.
          onCopy={() => void copyToClipboard(stripMentionLinks(message.body))}
          onReact={onReact}
          onReply={onReply}
          onEdit={onStartEdit}
          onPin={onPin}
          onDelete={onDelete}
          onThread={
            onOpenThread && thread
              ? () => onOpenThread(thread._id)
              : !thread && onCreateThread
                ? onCreateThread
                : undefined
          }
          reactOpen={reactOpen}
          setReactOpen={setReactOpen}
        />
      )}

      {/* Fixed-width gutter. The grouped-row time is always in flow — only its
          opacity animates — so hovering never reflows the row. */}
      <div className="flex w-10 shrink-0 justify-end">
        {grouped ? (
          <MessageTime
            at={message.createdAt}
            now={now}
            className="mt-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
          />
        ) : (
          // Avatar and name both open the author's profile card — the status a
          // user sets is the identity signal that's ours alone.
          <UserProfilePopover {...profile}>
            <Avatar
              initials={initialsOf(name)}
              color={message.author?.color ?? FALLBACK_AVATAR_COLOR}
              image={message.author?.avatarUrl}
              presence={presenceWithConnectivity(message.author?.presence, authorOnline)}
              className="mt-0.5 size-10 shrink-0 text-sm"
              ringClassName="ring-2 ring-card"
            />
          </UserProfilePopover>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {message.replyTo ? <MessageReply replyTo={message.replyTo} onJump={onJump} /> : null}

        {!grouped ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <UserProfilePopover {...profile}>
              <span className="max-w-[150px] truncate text-sm font-semibold hover:underline sm:max-w-none">
                {name}
              </span>
            </UserProfilePopover>
            {message.author?.statusEmoji ? (
              <span className="text-xs leading-none" title={message.author.statusText ?? undefined}>
                {message.author.statusEmoji}
              </span>
            ) : null}
            <AuthorRoleBadge userId={message.authorId} />
            <span className="text-muted-foreground">·</span>
            {pending ? (
              <span className="text-xs text-muted-foreground">
                {failed ? 'Not sent' : 'Sending…'}
              </span>
            ) : (
              <MessageTime at={message.createdAt} now={now} />
            )}
            {message.editedAt ? (
              <span className="text-xs italic text-muted-foreground">(edited)</span>
            ) : null}
            {indicators}
          </div>
        ) : indicators ? (
          <div className="mb-0.5 flex items-center gap-2">{indicators}</div>
        ) : null}

        {/* On a full row `(edited)` sits in the header beside the time; on a
            grouped row there is no header, so it trails the content. */}
        {message.body ? (
          <MarkdownMessage content={message.body} edited={grouped && Boolean(message.editedAt)} />
        ) : null}
        {message.attachments && message.attachments.length > 0 ? (
          <MessageAttachments attachments={message.attachments} pending={pending} />
        ) : null}

        {failed ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-destructive">
            <WarningCircle className="size-3.5" weight="fill" />
            <span>{failed}</span>
            {onRetry ? (
              <button type="button" onClick={onRetry} className="font-semibold hover:underline">
                Retry
              </button>
            ) : null}
            {onDiscard ? (
              <button
                type="button"
                onClick={onDiscard}
                className="font-semibold text-muted-foreground hover:underline"
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : null}

        {pending ? null : (
          <MessageReactions
            reactions={message.reactions}
            onToggle={onReact}
            onAdd={() => setReactOpen(true)}
          />
        )}
        {thread && onOpenThread ? (
          <ThreadIndicator thread={thread} now={now} onOpen={() => onOpenThread(thread._id)} />
        ) : null}
      </div>
    </div>
  )
}
