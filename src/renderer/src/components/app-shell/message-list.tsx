import { Fragment } from 'react'
import { ArrowsLeftRight, FileText, Hash, Lock, SpeakerHigh } from '@phosphor-icons/react'
import {
  currentUser,
  getMember,
  type Channel,
  type ChannelKind,
  type Message
} from '@renderer/data/workspaces'
import { MessageItem } from './message-item'

function channelIcon(kind: ChannelKind, className: string): React.JSX.Element {
  switch (kind) {
    case 'voice':
      return <SpeakerHigh className={className} />
    case 'page':
      return <FileText className={className} />
    default:
      return <Hash className={className} />
  }
}

export function MessageList({
  channel,
  serverId,
  messages
}: {
  channel: Channel
  serverId: string
  messages: Message[]
}): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col justify-end">
        <div className="px-4 pt-6 pb-2">
          <div className="mb-3 flex size-16 items-center justify-center rounded-full bg-muted text-foreground">
            {channel.private ? <Lock className="size-9" /> : channelIcon(channel.kind, 'size-9')}
          </div>
          <h1 className="text-3xl font-bold">Welcome to #{channel.name}!</h1>
          <p className="mt-1 text-muted-foreground">
            This is the start of the #{channel.name} channel.
            {channel.topic ? ` ${channel.topic}.` : ''}
          </p>
          {channel.shared ? (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
              <ArrowsLeftRight weight="bold" className="size-4" />
              Shared channel — members from connected servers can talk here.
            </div>
          ) : null}
        </div>

        {messages.map((message, index) => {
          const prev = messages[index - 1]
          const hasContent = Boolean(message.body || message.embed)
          const grouped = Boolean(
            prev &&
            prev.authorId === message.authorId &&
            !message.dateDivider &&
            !message.replyTo &&
            (prev.body || prev.embed)
          )
          return (
            <Fragment key={message.id}>
              {message.dateDivider ? <DateDivider label={message.dateDivider} /> : null}
              {hasContent ? (
                <MessageItem
                  message={message}
                  author={getMember(serverId, message.authorId) ?? currentUser}
                  grouped={grouped}
                />
              ) : null}
            </Fragment>
          )
        })}
        <div className="h-4" />
      </div>
    </div>
  )
}

function DateDivider({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="my-4 flex items-center gap-2 px-4">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
