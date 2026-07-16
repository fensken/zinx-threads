import { Scribble, CaretRight } from '@phosphor-icons/react'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { formatTimestamp } from '@renderer/lib/date-time'
import { initialsOf } from '@renderer/lib/initials'

export interface ThreadSummary {
  _id: string
  name: string
  replyCount: number
  lastReplyAt: number
  participants: { name: string; color?: string; avatarUrl?: string }[]
}

/** How many participant avatars the stack shows (the mock shows three). */
const AVATAR_STACK = 3

/** The affordance under a message that started a thread — participant stack,
 *  reply count, last-activity time. Ported from the demo's `ThreadIndicator`.
 *
 *  A brand-new thread has no replies yet, so it reads "Start the conversation"
 *  rather than "0 replies" — otherwise the row the user just created looks dead. */
export function ThreadIndicator({
  thread,
  now,
  onOpen
}: {
  thread: ThreadSummary
  now: Date
  onOpen: () => void
}): React.JSX.Element {
  const extra = thread.participants.length - AVATAR_STACK

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-1.5 flex w-fit max-w-full items-center gap-2 rounded-md py-1 pr-2 pl-1 transition-colors hover:bg-muted/60"
    >
      <span className="flex -space-x-1.5">
        {thread.participants.slice(0, AVATAR_STACK).map((participant, index) => (
          <Avatar
            key={`${participant.name}-${index}`}
            initials={initialsOf(participant.name)}
            color={participant.color ?? FALLBACK_AVATAR_COLOR}
            image={participant.avatarUrl}
            className="size-5 text-[9px] ring-2 ring-card"
          />
        ))}
        {extra > 0 ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-card">
            +{extra}
          </span>
        ) : null}
      </span>

      <span className="text-sm font-semibold text-primary">
        {thread.replyCount > 0
          ? `${thread.replyCount} ${thread.replyCount === 1 ? 'reply' : 'replies'}`
          : 'Start the conversation'}
      </span>

      {thread.replyCount > 0 ? (
        <span className="truncate text-xs text-muted-foreground">
          Last reply {formatTimestamp(thread.lastReplyAt, now)}
        </span>
      ) : (
        <span className="truncate text-xs text-muted-foreground">{thread.name}</span>
      )}

      <Scribble className="size-4 shrink-0 text-muted-foreground" />
      <CaretRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}
