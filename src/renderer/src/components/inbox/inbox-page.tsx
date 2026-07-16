import { useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { Check, List, Tray } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { IconButton } from '@renderer/components/common/icon-button'
import { SidebarToggle } from '@renderer/components/layout/sidebar-toggle'
import { InboxListSkeleton } from '@renderer/components/common/skeletons'
import { InboxRow } from '@renderer/components/inbox/inbox-row'
import { useOpenInboxItem } from '@renderer/lib/use-open-inbox-item'
import {
  INBOX_KINDS,
  INBOX_RANGES,
  sinceFor,
  type InboxKind,
  type InboxRange
} from '@renderer/lib/inbox-filters'
import { useNow } from '@renderer/lib/use-now'
import { useUiStore } from '@renderer/store/ui-store'
import { cn } from '@renderer/lib/utils'

/** The Inbox, in full: everything that concerns you, **across every workspace**.
 *
 *  That's the difference from the header flyout, which is a peek at the latest few.
 *  The inbox belongs to the *user* — "did anyone need me?" isn't a question you want
 *  to ask once per workspace — so each row says which workspace it came from and
 *  clicking it goes there, even if that means leaving the one you're in.
 *
 *  Both filters are pushed to the server as index bounds (`convex/inbox.ts`), not
 *  applied to a fetched page: filtering to "mentions, last 7 days" reads only the
 *  rows it returns. */
export function InboxPage(): React.JSX.Element {
  const [kind, setKind] = useState<InboxKind | 'all'>('all')
  const [range, setRange] = useState<InboxRange>('any')

  const items = useQuery(api.inbox.listForMe, {
    ...(kind === 'all' ? {} : { kind }),
    ...(sinceFor(range) === undefined ? {} : { since: sinceFor(range) })
  })
  const markAllRead = useMutation(api.inbox.markAllReadForMe)
  const open = useOpenInboxItem()
  const now = useNow()
  const setNavOpen = useUiStore((s) => s.setNavOpen)

  const hasUnread = (items ?? []).some((item) => !item.read)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <IconButton label="Open navigation" className="md:hidden" onClick={() => setNavOpen(true)}>
          <List className="size-5" />
        </IconButton>
        <SidebarToggle />
        <Tray className="size-5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold">Inbox</span>
        <span className="hidden text-sm text-muted-foreground xl:block">
          · across all your workspaces
        </span>

        {hasUnread ? (
          <button
            type="button"
            onClick={() => void markAllRead({})}
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Check className="size-3.5" weight="bold" />
            Mark all read
          </button>
        ) : null}
      </header>

      {/* Filters. Type is a tab strip (you switch between them constantly); date is a
          second, quieter row — you set it once and leave it. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2">
        {INBOX_KINDS.map((option) => (
          <FilterChip
            key={option.value}
            label={option.label}
            active={kind === option.value}
            onClick={() => setKind(option.value)}
          />
        ))}
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
        {INBOX_RANGES.map((option) => (
          <FilterChip
            key={option.value}
            label={option.label}
            active={range === option.value}
            muted
            onClick={() => setRange(option.value)}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col p-3">
          {items === undefined ? (
            <InboxListSkeleton rows={8} />
          ) : items.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
              <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Tray className="size-5" />
              </span>
              <p className="text-sm font-medium">
                {kind === 'all' && range === 'any' ? "You're all caught up" : 'Nothing matches'}
              </p>
              <p className="max-w-72 text-xs text-muted-foreground">
                {kind === 'all' && range === 'any'
                  ? 'Mentions, replies, thread activity and direct messages land here — from every workspace you’re in.'
                  : 'Try a different type or a wider date range.'}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {items.map((item) => (
                <InboxRow key={item._id} item={item} now={now} showWorkspace onOpen={open} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FilterChip({
  label,
  active,
  muted,
  onClick
}: {
  label: string
  active: boolean
  /** The date row: same control, lower contrast, so type reads as the primary axis. */
  muted?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active
          ? muted
            ? 'bg-muted text-foreground'
            : 'bg-accent font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}
