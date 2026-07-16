import { ArrowBendUpLeft, At, ChatCircle, Scribble } from '@phosphor-icons/react'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { formatTimestamp } from '@renderer/lib/date-time'
import { initialsOf } from '@renderer/lib/initials'
import { messagePreview } from '@renderer/lib/message-preview'
import type { InboxItem } from '@renderer/lib/use-open-inbox-item'
import { cn } from '@renderer/lib/utils'

function kindIcon(kind: InboxItem['kind'], className: string): React.JSX.Element {
  if (kind === 'reply') return <ArrowBendUpLeft className={className} />
  if (kind === 'thread') return <Scribble className={className} />
  if (kind === 'dm') return <ChatCircle className={className} />
  return <At className={className} />
}

function kindLabel(kind: InboxItem['kind']): string {
  if (kind === 'reply') return 'replied to you'
  if (kind === 'thread') return 'posted in a thread'
  if (kind === 'dm') return 'messaged you'
  return 'mentioned you'
}

/** One inbox row. Shared by the header's quick list and the full page, so a
 *  notification reads identically wherever you meet it — only `showWorkspace`
 *  differs. */
export function InboxRow({
  item,
  now,
  showWorkspace,
  onOpen
}: {
  item: InboxItem
  now: Date
  /** The inbox spans workspaces, so a row has to say which one it came from. */
  showWorkspace?: boolean
  onOpen: (item: InboxItem) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
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
            {kindLabel(item.kind)}
            {/* A DM happened between you two — there's no channel to name, and its
                stored name is an id. "Alice messaged you." */}
            {item.channelKind === 'dm' ? null : (
              <>
                {' in '}
                <span className="font-medium text-foreground">#{item.channelName}</span>
              </>
            )}
          </span>
          <span className="ml-auto shrink-0">{formatTimestamp(item.createdAt, now)}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-foreground">{messagePreview(item.body).text}</p>
        {showWorkspace ? (
          <span className="mt-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {item.workspaceName}
          </span>
        ) : null}
      </div>
      {!item.read ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" /> : null}
    </button>
  )
}
