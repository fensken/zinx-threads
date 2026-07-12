import { Gif, X } from '@phosphor-icons/react'
import { messagePreview } from '@renderer/lib/message-preview'

export interface ReplyTargetMessage {
  _id: string
  body: string
  authorName: string
}

/** The "Replying to …" chip that sits directly above the composer (mirrors
 *  `_zinx`'s `ReplyTarget`). Dismissing it cancels the reply. */
export function ReplyTarget({
  message,
  onCancel
}: {
  message: ReplyTargetMessage
  onCancel: () => void
}): React.JSX.Element {
  const { isGif, text } = messagePreview(message.body)

  return (
    <div className="relative mb-1 rounded-t-xl border border-b-0 bg-muted/50 px-3 py-2 pr-9 text-sm">
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        title="Cancel reply"
        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-4" />
      </button>
      <div className="flex min-w-0 items-baseline gap-1">
        <span className="shrink-0 text-xs text-muted-foreground">Replying to</span>
        <span className="shrink-0 text-xs font-medium">{message.authorName}</span>
      </div>
      {isGif ? (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground italic">
          <Gif className="size-3.5" />
          GIF
        </p>
      ) : (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{text}</p>
      )}
    </div>
  )
}
