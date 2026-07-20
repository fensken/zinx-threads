import type { TypingUser } from '@renderer/lib/use-channel-typing'

/** Turn the set of typers into Slack's line: "Alice is typing…", "Alice and Bob
 *  are typing…", "Alice, Bob and Carol are typing…", then "Several people are
 *  typing…" past three so it never runs long. First names only. */
function typingText(users: TypingUser[]): string {
  const names = users.map((u) => u.name.split(/\s+/)[0] || u.name)
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing…`
  return 'Several people are typing…'
}

/** The "…is typing" line, shown flush above the composer. Renders nothing when the
 *  channel is quiet, and reserves no height then — but it sits in a fixed-height
 *  strip in the assembly so its appearance doesn't shove the composer. */
export function TypingIndicator({ users }: { users: TypingUser[] }): React.JSX.Element | null {
  if (users.length === 0) return null
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      <span className="flex items-end gap-0.5" aria-hidden>
        <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
        <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
        <span className="size-1 animate-bounce rounded-full bg-muted-foreground" />
      </span>
      <span className="truncate">{typingText(users)}</span>
    </div>
  )
}
