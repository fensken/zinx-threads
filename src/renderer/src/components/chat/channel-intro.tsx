import { ChatCircle } from '@phosphor-icons/react'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'

/** Discord-style "start of channel" header, shown at the very top of a channel once
 *  its full history is loaded (or when it's empty): a large kind glyph, a welcome
 *  heading, the start-of-channel line, and the channel topic when one is set. It's
 *  the anchor that tells you you've reached the beginning of the conversation.
 *
 *  A **DM** has no channel name — its `channel.name` is an internal `dm-<ids>` key that
 *  must never be shown (see `lib/dm.ts`). So a DM passes `isDm` + the participants' title
 *  as `name`, and the intro drops the `#` and uses conversation copy + a chat glyph. */
export function ChannelIntro({
  name,
  kind,
  topic,
  isDm = false
}: {
  name: string
  kind: string
  topic?: string
  isDm?: boolean
}): React.JSX.Element {
  return (
    <div className="px-4 pt-6 pb-3">
      <span className="mb-4 flex size-[68px] items-center justify-center rounded-full bg-muted">
        {isDm ? (
          <ChatCircle className="size-9 text-muted-foreground" />
        ) : (
          <ChannelKindIcon kind={kind} className="size-9 text-muted-foreground" />
        )}
      </span>
      <h2 className="text-[1.6rem] leading-tight font-bold text-foreground">
        {isDm ? name : `Welcome to #${name}!`}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isDm
          ? `This is the beginning of your direct message history with ${name}.`
          : `This is the start of the #${name} channel.`}
      </p>
      {topic ? <p className="mt-1 text-sm text-muted-foreground">{topic}</p> : null}
    </div>
  )
}
