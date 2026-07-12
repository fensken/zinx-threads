import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { Badge } from '@renderer/components/ui/badge'
import { cn } from '@renderer/lib/utils'
import type { MemberRole } from '@renderer/components/chat/workspace-directory-context'

// Ported from `_zinx`'s `ROLE_CONFIG` (it also has a `moderator` role; our
// workspaces have only owner/admin/member). Role colours are categorical — the
// sanctioned hardcoded-colour exception, same as presence and the amber
// "mentioned you" tag.
const ROLE_CONFIG: Record<Exclude<MemberRole, 'member'>, { label: string; className: string }> = {
  owner: { label: 'Owner', className: 'bg-primary/15 text-primary border-primary/30' },
  admin: {
    label: 'Admin',
    className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30'
  }
}

/** The author's workspace role, beside their name in a message header — as in
 *  `_zinx`. Members get nothing (the default is unremarkable), and so does an
 *  author we can't resolve (no directory, or they left). */
export function AuthorRoleBadge({
  userId,
  className
}: {
  userId: string
  className?: string
}): React.JSX.Element | null {
  const directory = useWorkspaceDirectory()
  const role = directory?.memberById(userId)?.role
  if (!role || role === 'member') return null

  const config = ROLE_CONFIG[role]
  return (
    <Badge variant="outline" className={cn('h-4 shrink-0 text-xs', config.className, className)}>
      {config.label}
    </Badge>
  )
}
