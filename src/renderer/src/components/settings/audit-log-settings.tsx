import { useState } from 'react'
import { usePaginatedQuery } from 'convex/react'
import { ClockCounterClockwise } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { initialsOf } from '@renderer/lib/initials'

/** Human labels for the action filter — the raw dotted keys are never shown to users
 *  (the id/label rule). `all` is the unfiltered sentinel; it shows "All events", never
 *  the sentinel string. */
const ACTION_LABELS: Record<string, string> = {
  all: 'All events',
  'member.role_changed': 'Role changed',
  'member.removed': 'Member removed',
  'member.left': 'Member left',
  'channel.created': 'Channel created',
  'channel.renamed': 'Channel renamed',
  'channel.deleted': 'Channel deleted',
  'workspace.updated': 'Workspace updated',
  'retention.updated': 'Retention changed',
  'bot.created': 'Bot created',
  'bot.removed': 'Bot removed'
}

/**
 * Workspace settings → **Audit log** (owner/admin). The append-only trail of
 * administrative actions, newest first, with a type filter. Each row's summary was
 * resolved at write time, so this never joins back to a (possibly deleted) target.
 */
export function AuditLogTab({ workspaceId }: { workspaceId: Id<'workspaces'> }): React.JSX.Element {
  const [action, setAction] = useState<string>('all')
  const { results, status, loadMore } = usePaginatedQuery(
    api.audit.listByWorkspace,
    { workspaceId, ...(action === 'all' ? {} : { action }) },
    { initialNumItems: 25 }
  )

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <ClockCounterClockwise className="size-5 text-primary" weight="fill" />
          <h3 className="text-sm font-semibold">Audit log</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          A record of administrative actions in this workspace — role changes, member removals,
          channel and bot changes, and policy updates.
        </p>
      </section>

      <div className="w-56">
        <Select value={action} onValueChange={(v) => setAction(v ?? 'all')} items={ACTION_LABELS}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {status === 'LoadingFirstPage' ? (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      ) : results.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No audit events yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {results.map((row) => (
            <li key={row._id} className="flex items-start gap-3 px-3 py-2.5">
              <Avatar
                initials={initialsOf(row.actorName)}
                color={FALLBACK_AVATAR_COLOR}
                className="mt-0.5 size-6"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">{row.actorName}</span>{' '}
                  <span className="text-muted-foreground">{row.summary}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {status === 'CanLoadMore' ? (
        <Button variant="outline" size="sm" onClick={() => loadMore(25)}>
          Load more
        </Button>
      ) : status === 'LoadingMore' ? (
        <div className="flex justify-center py-2">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      ) : null}
    </div>
  )
}
