import { Fragment } from 'react'
import { ArrowBendUpLeft, ChatsCircle, DotsThree, Smiley } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import {
  currentUser,
  getMember,
  getRole,
  type Embed,
  type Message,
  type Member,
  type Reaction,
  type ReplyRef,
  type ThreadSummary
} from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'
import { Avatar } from './avatar'

function shortTime(time: string): string {
  return time.split(' ').slice(-2).join(' ')
}

function renderContent(text: string): React.ReactNode {
  return text.split(/(\s+)/).map((token, index) => {
    if (/^https?:\/\//.test(token)) {
      return (
        <span key={index} className="cursor-pointer text-primary hover:underline">
          {token}
        </span>
      )
    }
    if (token === '@everyone' || token === '@here' || /^@[\w-]+$/.test(token)) {
      return (
        <span key={index} className="rounded bg-primary/20 px-0.5 font-medium text-primary">
          {token}
        </span>
      )
    }
    return <Fragment key={index}>{token}</Fragment>
  })
}

export function MessageItem({
  message,
  author,
  grouped
}: {
  message: Message
  author: Member
  grouped: boolean
}): React.JSX.Element {
  const roleColor = getRole(author.roleId)?.color

  return (
    <div
      className={cn(
        'group relative mx-2 flex gap-4 rounded-lg px-2 py-1 transition-colors hover:bg-muted/40',
        grouped ? '' : 'mt-3'
      )}
    >
      <HoverToolbar message={message} />

      <div className="w-10 shrink-0">
        {grouped ? (
          <span className="mt-1 hidden text-right text-[10px] leading-5 text-muted-foreground group-hover:block">
            {shortTime(message.time)}
          </span>
        ) : (
          <Avatar
            initials={author.initials}
            color={author.color}
            className="mt-0.5 size-10 text-sm"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {message.replyTo ? <ReplyRefLine reply={message.replyTo} /> : null}
        {!grouped ? (
          <div className="flex items-baseline gap-2">
            <span
              className="text-sm font-semibold hover:underline"
              style={roleColor ? { color: roleColor } : undefined}
            >
              {author.name}
            </span>
            {author.bot ? <BotBadge /> : null}
            <span className="text-xs text-muted-foreground">{message.time}</span>
          </div>
        ) : null}

        {message.body ? (
          <p className="text-[0.9375rem] leading-[1.45] text-foreground/90">
            {renderContent(message.body)}
            {message.edited ? (
              <span className="ml-1 align-baseline text-[10px] text-muted-foreground">
                (edited)
              </span>
            ) : null}
          </p>
        ) : null}

        {message.embed ? <MessageEmbed embed={message.embed} /> : null}
        {message.reactions?.length ? <ReactionBar reactions={message.reactions} /> : null}
        {message.thread ? <ThreadIndicator thread={message.thread} /> : null}
      </div>
    </div>
  )
}

function HoverToolbar({ message }: { message: Message }): React.JSX.Element {
  const setReplyingTo = useUiStore((state) => state.setReplyingTo)
  const openThread = useUiStore((state) => state.openThread)
  const threadId = message.thread?.id ?? 't-launch'

  return (
    <div className="absolute -top-4 right-2 z-10 hidden overflow-hidden rounded-md border bg-popover shadow-md group-hover:flex">
      <ToolbarButton label="Add reaction">
        <Smiley className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Reply" onClick={() => setReplyingTo(message.id)}>
        <ArrowBendUpLeft className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Create thread" onClick={() => openThread(threadId)}>
        <ChatsCircle className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="More">
        <DotsThree className="size-4" weight="bold" />
      </ToolbarButton>
    </div>
  )
}

function ToolbarButton({
  label,
  children,
  onClick
}: {
  label: string
  children: React.ReactNode
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}

function BotBadge(): React.JSX.Element {
  return (
    <span className="rounded bg-primary px-1 py-px text-[10px] font-bold text-primary-foreground uppercase">
      App
    </span>
  )
}

function ReplyRefLine({ reply }: { reply: ReplyRef }): React.JSX.Element {
  const author = getMember('zinx', reply.authorId)
  return (
    <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
      <ArrowBendUpLeft className="size-3.5 shrink-0 -scale-x-100 opacity-60" />
      <span className="font-medium text-foreground/80">{author?.name ?? 'someone'}</span>
      <span className="truncate">{reply.body}</span>
    </div>
  )
}

function MessageEmbed({ embed }: { embed: Embed }): React.JSX.Element {
  return (
    <div className="mt-1 max-w-lg rounded-md border-l-4 border-primary bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{embed.siteName}</div>
      <div className="mt-0.5 cursor-pointer font-semibold text-primary hover:underline">
        {embed.title}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{embed.description}</div>
    </div>
  )
}

function ReactionBar({ reactions }: { reactions: Reaction[] }): React.JSX.Element {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          className={cn(
            'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs transition-colors',
            reaction.reacted
              ? 'border-primary bg-primary/15 text-foreground'
              : 'border-transparent bg-muted/60 text-muted-foreground hover:border-border'
          )}
        >
          <span className="text-sm leading-none">{reaction.emoji}</span>
          <span className="font-semibold">{reaction.count}</span>
        </button>
      ))}
      <button
        type="button"
        title="Add reaction"
        aria-label="Add reaction"
        className="flex size-6 items-center justify-center rounded-md bg-muted/60 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
      >
        <Smiley className="size-4" />
      </button>
    </div>
  )
}

function ThreadIndicator({ thread }: { thread: ThreadSummary }): React.JSX.Element {
  const openThread = useUiStore((state) => state.openThread)
  return (
    <button
      type="button"
      onClick={() => openThread(thread.id)}
      className="mt-1.5 flex w-fit max-w-full items-center gap-2 rounded-md py-1 pr-3 pl-1 transition-colors hover:bg-muted/60"
    >
      <span className="flex -space-x-1.5">
        {thread.participantIds.slice(0, 3).map((id) => (
          <ThreadParticipant key={id} id={id} />
        ))}
      </span>
      <span className="text-sm font-semibold text-primary">{thread.replyCount} replies</span>
      <span className="truncate text-xs text-muted-foreground">
        Last reply {thread.lastReplyAgo}
      </span>
      <ChatsCircle className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

function ThreadParticipant({ id }: { id: string }): React.JSX.Element {
  const member = getMember('zinx', id) ?? currentUser
  return (
    <Avatar
      initials={member.initials}
      color={member.color}
      className="size-5 ring-2 ring-background"
    />
  )
}
