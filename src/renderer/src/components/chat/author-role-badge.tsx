import { Robot } from '@phosphor-icons/react'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import type { MemberRole } from '@renderer/components/chat/workspace-directory-context'

// Ported from `_zinx`'s `ROLE_CONFIG`. Role colours are categorical (`--info`, `--warning`)
// — the sanctioned token-not-brand exception, same as presence.
//
// A **guest** is badged, and that's the point: they can see only the channels they were
// added to, so anyone talking to them needs to know that without having to check. Slack
// does the same. `member` is the unremarkable default and gets nothing.
const ROLE_CONFIG: Record<Exclude<MemberRole, 'member'>, { label: string; className: string }> = {
  owner: { label: 'Owner', className: 'bg-primary/15 text-primary border-primary/30' },
  admin: {
    label: 'Admin',
    className: 'bg-info/15 text-info border-info/30'
  },
  guest: {
    label: 'Guest',
    className: 'bg-warning/15 text-warning border-warning/30'
  }
}

/** A "BOT" pill with a robot glyph — the app-wide marker for a non-human member. Used
 *  beside a bot's name in the message header, the member list and its profile card, so it
 *  reads the same everywhere. Categorical colour (`--info`), like the role badges. */
export function BotBadge({ className }: { className?: string }): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-4 shrink-0 gap-0.5 border-info/30 bg-info/15 px-1 text-xs text-info',
        className
      )}
    >
      <Robot className="size-3" weight="fill" />
      Bot
    </Badge>
  )
}

/** The author's marker beside their name in a message header — a **BOT** pill for a bot
 *  principal, else their workspace role (owner/admin/guest; a plain member gets nothing, as
 *  in `_zinx`). Null for an author we can't resolve (no directory, or they left). */
export function AuthorRoleBadge({
  userId,
  className
}: {
  userId: string
  className?: string
}): React.JSX.Element | null {
  const directory = useWorkspaceDirectory()
  const member = directory?.memberById(userId)
  if (!member) return null
  if (member.isBot) return <BotBadge className={className} />
  if (member.role === 'member') return null

  const config = ROLE_CONFIG[member.role]
  return (
    <Badge variant="outline" className={cn('h-4 shrink-0 text-xs', config.className, className)}>
      {config.label}
    </Badge>
  )
}
