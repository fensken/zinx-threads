import { useId } from 'react'
import { cn } from '@renderer/lib/utils'
import type { UserStatus } from '@renderer/lib/user-status'

// Presence colours (categorical — the allowed hardcoded-colour exception, same
// palette as `PresenceDot`).
const COLOR: Record<UserStatus, string> = {
  online: 'text-emerald-500',
  away: 'text-amber-400',
  dnd: 'text-red-500',
  invisible: 'text-muted-foreground'
}

/** A distinct status glyph (inspired by Discord's masked shapes, in our palette):
 *  online = filled dot · away = crescent · dnd = minus-circle · invisible = ring.
 *  Cutouts are transparent (SVG masks) so they read on any row background. */
export function StatusGlyph({
  status,
  className
}: {
  status: UserStatus
  className?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn('shrink-0', COLOR[status], className)}>
      {status === 'online' ? <circle cx="8" cy="8" r="4" fill="currentColor" /> : null}

      {status === 'away' ? (
        <>
          <mask id={id}>
            <rect width="16" height="16" fill="white" />
            <circle cx="11.5" cy="4.5" r="3.5" fill="black" />
          </mask>
          <circle cx="8" cy="8" r="4.25" fill="currentColor" mask={`url(#${id})`} />
        </>
      ) : null}

      {status === 'dnd' ? (
        <>
          <mask id={id}>
            <rect width="16" height="16" fill="white" />
            <rect x="5" y="7" width="6" height="2" rx="1" fill="black" />
          </mask>
          <circle cx="8" cy="8" r="4.25" fill="currentColor" mask={`url(#${id})`} />
        </>
      ) : null}

      {status === 'invisible' ? (
        <circle cx="8" cy="8" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      ) : null}
    </svg>
  )
}
