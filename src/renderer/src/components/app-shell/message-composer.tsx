import { useState } from 'react'
import { Gift, Plus, Smiley, Sticker, X } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import { type Channel } from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'

export function MessageComposer({
  channel,
  replyToName,
  onSend
}: {
  channel: Channel
  replyToName: string | null
  onSend: (body: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const setReplyingTo = useUiStore((state) => state.setReplyingTo)

  const submit = (): void => {
    const body = value.trim()
    if (!body) return
    onSend(body)
    setValue('')
    setReplyingTo(null)
  }

  return (
    <div className="shrink-0 px-4 pt-2 pb-2">
      {replyToName ? (
        <div className="flex items-center justify-between rounded-t-lg bg-muted/70 px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            Replying to <span className="font-semibold text-foreground">{replyToName}</span>
          </span>
          <button
            type="button"
            aria-label="Cancel reply"
            title="Cancel reply"
            onClick={() => setReplyingTo(null)}
            className="flex size-5 items-center justify-center rounded-full bg-muted-foreground/30 text-foreground hover:bg-muted-foreground/50"
          >
            <X className="size-3" weight="bold" />
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          'flex items-end gap-2 bg-muted px-3',
          replyToName ? 'rounded-b-lg' : 'rounded-lg'
        )}
      >
        <button
          type="button"
          title="Upload a file"
          aria-label="Upload a file"
          className="my-2.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground/70 text-background transition-colors hover:bg-foreground"
        >
          <Plus className="size-4" weight="bold" />
        </button>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder={`Message #${channel.name}`}
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="my-2.5 flex shrink-0 items-center gap-1 text-muted-foreground">
          <ComposerIcon label="Send a gift">
            <Gift className="size-5" />
          </ComposerIcon>
          <button
            type="button"
            title="Pick a GIF"
            aria-label="Pick a GIF"
            className="rounded px-1 text-xs font-bold hover:text-foreground"
          >
            GIF
          </button>
          <ComposerIcon label="Sticker">
            <Sticker className="size-5" />
          </ComposerIcon>
          <ComposerIcon label="Emoji">
            <Smiley className="size-5" />
          </ComposerIcon>
        </div>
      </div>
    </div>
  )
}

function ComposerIcon({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex size-6 items-center justify-center transition-colors hover:text-foreground"
    >
      {children}
    </button>
  )
}
