import { ArrowElbowLeftDown, Gif } from '@phosphor-icons/react'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { messagePreview } from '@renderer/lib/message-preview'

export interface ReplyPreview {
  _id: string
  body: string
  authorName: string
  authorAvatarUrl?: string
  authorColor?: string
  authorIsMe: boolean
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** The quoted line above a reply (mirrors `_zinx`'s `MessageReply`): an elbow
 *  arrow, the author's avatar + name, and a one-line preview. Clicking jumps to
 *  the original. */
export function MessageReply({
  replyTo,
  onJump
}: {
  replyTo: ReplyPreview
  onJump: (messageId: string) => void
}): React.JSX.Element {
  const { isGif, text } = messagePreview(replyTo.body)

  return (
    <div className="mb-0.5 flex items-center gap-1.5">
      <ArrowElbowLeftDown className="size-3.5 shrink-0 text-muted-foreground" />
      <button
        type="button"
        onClick={() => onJump(replyTo._id)}
        title="Jump to message"
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <Avatar
          initials={initialsOf(replyTo.authorName)}
          color={replyTo.authorColor ?? FALLBACK_AVATAR_COLOR}
          image={replyTo.authorAvatarUrl}
          className="size-4 text-[8px]"
        />
        <span className="shrink-0 font-medium text-foreground">{replyTo.authorName}</span>
        {isGif ? (
          <span className="flex items-center gap-1 italic">
            <Gif className="size-3.5" />
            GIF
          </span>
        ) : (
          <span className="truncate">{text}</span>
        )}
      </button>
    </div>
  )
}
