import { Smiley } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'

export interface MessageReaction {
  emoji: string
  count: number
  reacted: boolean
}

/** Reaction pills under a message (mirrors `_zinx`): emoji + count, highlighted
 *  when you're one of the reactors. Clicking toggles your reaction. The trailing
 *  `+` opens the picker (only shown once a message already has reactions — an
 *  untouched message gets its picker from the hover toolbar). */
export function MessageReactions({
  reactions,
  onToggle,
  onAdd
}: {
  reactions: MessageReaction[]
  onToggle: (emoji: string) => void
  onAdd?: () => void
}): React.JSX.Element | null {
  if (!reactions.length) return null

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          onClick={() => onToggle(reaction.emoji)}
          title={reaction.reacted ? 'Remove your reaction' : `React with ${reaction.emoji}`}
          className={cn(
            'flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors',
            reaction.reacted
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-transparent bg-muted text-muted-foreground hover:border-border'
          )}
        >
          <span className="text-sm leading-none">{reaction.emoji}</span>
          <span className="font-medium tabular-nums">{reaction.count}</span>
        </button>
      ))}
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          title="Add a reaction"
          aria-label="Add a reaction"
          className="flex h-6 items-center rounded-full border border-transparent bg-muted px-1.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <Smiley className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
