import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'

/** Discord-style "start of channel" header, shown at the very top of a channel once
 *  its full history is loaded (or when it's empty): a large kind glyph, a welcome
 *  heading, the start-of-channel line, and the channel topic when one is set. It's
 *  the anchor that tells you you've reached the beginning of the conversation. */
export function ChannelIntro({
  name,
  kind,
  topic
}: {
  name: string
  kind: string
  topic?: string
}): React.JSX.Element {
  return (
    <div className="px-4 pt-6 pb-3">
      <span className="mb-4 flex size-[68px] items-center justify-center rounded-full bg-muted">
        <ChannelKindIcon kind={kind} className="size-9 text-muted-foreground" />
      </span>
      <h2 className="text-[1.6rem] leading-tight font-bold text-foreground">Welcome to #{name}!</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This is the start of the #{name} channel.
      </p>
      {topic ? <p className="mt-1 text-sm text-muted-foreground">{topic}</p> : null}
    </div>
  )
}
