import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import type { FunctionReturnType } from 'convex/server'
import { ArrowBendUpLeft, At, ChatsCircle, Check, Tray } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { NavEmptyState } from '@renderer/components/chat/nav-flyout'
import { formatTimestamp } from '@renderer/lib/date-time'
import { initialsOf } from '@renderer/lib/initials'
import { messagePreview } from '@renderer/lib/message-preview'
import { useNow } from '@renderer/lib/use-now'
import { useUiStore } from '@renderer/store/ui-store'
import { cn } from '@renderer/lib/utils'

type InboxItem = FunctionReturnType<typeof api.inbox.listByWorkspace>[number]
type Filter = 'all' | 'mention'

function kindIcon(kind: InboxItem['kind'], className: string): React.JSX.Element {
  if (kind === 'reply') return <ArrowBendUpLeft className={className} />
  if (kind === 'thread') return <ChatsCircle className={className} />
  return <At className={className} />
}

function kindLabel(kind: InboxItem['kind']): string {
  if (kind === 'reply') return 'replied to you'
  if (kind === 'thread') return 'posted in a thread'
  return 'mentioned you'
}

/** The Inbox flyout body — mentions, replies and thread activity, newest first.
 *  Backed by `inbox.listByWorkspace`; clicking a row clears it and jumps to where
 *  it happened (the thread, if it's a thread notification, else the channel). */
export function RealInboxList({
  workspaceId,
  workspaceSlug,
  onNavigate
}: {
  workspaceId: Id<'workspaces'>
  workspaceSlug: string
  /** Closes the flyout after a row is opened. */
  onNavigate: () => void
}): React.JSX.Element {
  const items = useQuery(api.inbox.listByWorkspace, { workspaceId })
  const markRead = useMutation(api.inbox.markRead)
  const markAllRead = useMutation(api.inbox.markAllRead)
  const openThread = useUiStore((state) => state.openThread)
  const navigate = useNavigate()
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(
    () => (items ?? []).filter((item) => filter === 'all' || item.kind === 'mention'),
    [items, filter]
  )
  const hasUnread = (items ?? []).some((item) => !item.read)

  if (items === undefined) return <LoadingBlock />

  const open = (item: InboxItem): void => {
    void markRead({ notificationId: item._id })
    void navigate({
      to: '/w/$workspaceId/$channelSlug',
      params: { workspaceId: workspaceSlug, channelSlug: item.channelName }
    })
    // A thread notification takes you into the thread panel, not just the channel.
    if (item.threadId) openThread(item.threadId)
    onNavigate()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-center gap-1">
        <FilterTab label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterTab
          label="Mentions"
          active={filter === 'mention'}
          onClick={() => setFilter('mention')}
        />
        {hasUnread ? (
          <button
            type="button"
            onClick={() => void markAllRead({ workspaceId })}
            title="Mark all as read"
            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Check className="size-3.5" weight="bold" />
            Mark all read
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <NavEmptyState
          icon={<Tray className="size-5" />}
          title={filter === 'mention' ? 'No mentions' : "You're all caught up"}
          message="Mentions, replies and thread activity show up here."
        />
      ) : (
        <div className="-mx-1 space-y-0.5">
          {filtered.map((item) => (
            <button
              key={item._id}
              type="button"
              onClick={() => open(item)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent',
                !item.read && 'bg-primary/5'
              )}
            >
              <Avatar
                initials={initialsOf(item.actorName)}
                color={item.actorColor ?? FALLBACK_AVATAR_COLOR}
                image={item.actorAvatarUrl}
                className="mt-0.5 size-8 text-xs"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {kindIcon(item.kind, 'size-3 shrink-0')}
                  <span className="truncate">
                    <span className="font-medium text-foreground">{item.actorName}</span>{' '}
                    {kindLabel(item.kind)} in{' '}
                    <span className="font-medium text-foreground">#{item.channelName}</span>
                  </span>
                  <span className="ml-auto shrink-0">{formatTimestamp(item.createdAt, now)}</span>
                </div>
                <p className="mt-0.5 truncate text-sm text-foreground/90">
                  {messagePreview(item.body).text}
                </p>
              </div>
              {!item.read ? (
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterTab({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-accent font-semibold text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}
