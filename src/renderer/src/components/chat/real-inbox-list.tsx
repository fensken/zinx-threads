import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { ArrowRight, Check, Tray } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { NavEmptyState } from '@renderer/components/chat/nav-flyout'
import { InboxRow } from '@renderer/components/inbox/inbox-row'
import { useOpenInboxItem } from '@renderer/lib/use-open-inbox-item'
import { useNow } from '@renderer/lib/use-now'

/** How many the peek shows. Deliberately small: this answers "anything new?", not
 *  "show me my inbox" — that's the page, one click away. */
const PEEK = 8

/** The header's Inbox flyout — a **quick list of the latest**, with a way through to
 *  the full page. The sidebar's Inbox row goes straight to the page; the header
 *  gives you the glance without leaving the channel you're reading.
 *
 *  Like the page, it's user-scoped: rows from every workspace you're in, not just
 *  the one you happen to be looking at. */
export function RealInboxList({
  workspaceSlug,
  onNavigate
}: {
  /** Only to build the "Open inbox" link. The inbox page lives inside the workspace
   *  shell so you keep the sidebar and switcher — its *content* is user-wide, but a
   *  full-page view with no navigation would be a dead end. */
  workspaceSlug: string
  onNavigate: () => void
}): React.JSX.Element {
  const items = useQuery(api.inbox.listForMe, { limit: PEEK })
  const markAllRead = useMutation(api.inbox.markAllReadForMe)
  const open = useOpenInboxItem()
  const navigate = useNavigate()
  const now = useNow()

  if (items === undefined) return <LoadingBlock />
  const hasUnread = items.some((item) => !item.read)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {items.length === 0 ? (
        <NavEmptyState
          icon={<Tray className="size-5" />}
          title="You're all caught up"
          message="Mentions, replies, thread activity and direct messages show up here."
        />
      ) : (
        <>
          {hasUnread ? (
            <button
              type="button"
              onClick={() => void markAllRead({})}
              className="mb-1 ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Check className="size-3.5" weight="bold" />
              Mark all read
            </button>
          ) : null}
          <div className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {items.map((item) => (
              <InboxRow
                key={item._id}
                item={item}
                now={now}
                showWorkspace
                onOpen={(entry) => {
                  open(entry)
                  onNavigate()
                }}
              />
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => {
          void navigate({
            to: '/w/$workspaceId/inbox',
            params: { workspaceId: workspaceSlug }
          })
          onNavigate()
        }}
        className="mt-1 flex shrink-0 items-center justify-center gap-1.5 border-t px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Open inbox
        <ArrowRight className="size-3.5" weight="bold" />
      </button>
    </div>
  )
}
