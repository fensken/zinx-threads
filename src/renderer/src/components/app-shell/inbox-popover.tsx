import { At, ArrowBendUpLeft, ChatsCircle, Tray, X } from '@phosphor-icons/react'
import {
  currentUser,
  getMember,
  getNotifications,
  type Notification
} from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'
import { Avatar } from './avatar'

const TABS = ['For You', 'Unreads', 'Mentions']

function notifIcon(kind: Notification['kind'], className: string): React.JSX.Element {
  if (kind === 'reply') return <ArrowBendUpLeft className={className} />
  if (kind === 'thread') return <ChatsCircle className={className} />
  return <At className={className} />
}

export function InboxPopover(): React.JSX.Element | null {
  const open = useUiStore((state) => state.inboxOpen)
  const setOpen = useUiStore((state) => state.setInboxOpen)

  if (!open) return null
  const notifications = getNotifications()

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      <div className="absolute top-full right-0 z-50 mt-2 flex max-h-[70dvh] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <Tray className="size-5" />
          <span className="font-semibold">Inbox</span>
          <button
            type="button"
            aria-label="Close inbox"
            onClick={() => setOpen(false)}
            className="ml-auto flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="flex gap-1 border-b px-3 py-2">
          {TABS.map((tab, index) => (
            <span
              key={tab}
              className={
                index === 0
                  ? 'rounded-md bg-accent px-2 py-1 text-xs font-semibold text-foreground'
                  : 'rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground'
              }
            >
              {tab}
            </span>
          ))}
        </div>
        <div className="no-scrollbar flex-1 overflow-y-auto">
          {notifications.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} />
          ))}
        </div>
      </div>
    </>
  )
}

function NotificationRow({ notification }: { notification: Notification }): React.JSX.Element {
  const author = getMember('zinx', notification.authorId) ?? currentUser

  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent/50"
    >
      <Avatar initials={author.initials} color={author.color} className="mt-0.5 size-9" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {notifIcon(notification.kind, 'size-3.5')}
          <span className="truncate font-medium text-foreground">#{notification.channelName}</span>
          <span className="ml-auto shrink-0">{notification.ago}</span>
        </div>
        <p className="mt-0.5 truncate text-sm text-foreground/90">{notification.preview}</p>
      </div>
      {notification.unread ? (
        <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
      ) : null}
    </button>
  )
}
