import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { Plus } from '@phosphor-icons/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { NewDmDialog } from '@renderer/components/chat/new-dm-dialog'
import { dmTitle, dmInitials } from '@renderer/lib/dm'
import { presenceWithConnectivity } from '@renderer/lib/user-status'
import { useIsOnline } from '@renderer/store/presence-store'
import { cn } from '@renderer/lib/utils'

type Dm = FunctionReturnType<typeof api.dms.listMine>[number]
type ChannelUnread = FunctionReturnType<typeof api.unread.listByWorkspace>[number]

/** The sidebar's **Direct messages** section (Slack/Discord). Conversations are not
 *  channels — they're not in the channel tree, they can't be grouped, renamed or
 *  dragged — so they get their own section, sorted by most recent activity, with a
 *  `+` to start a new one.
 *
 *  Unread comes from the same `unread.listByWorkspace` subscription the channel rows
 *  use (it folds in your DMs), so there's no extra query. Unlike a channel, a DM's
 *  pill counts **messages**, not mentions — everything in it is addressed to you. */
export function DmSection({
  serverId,
  workspaceId,
  unreadByChannel
}: {
  serverId: string
  workspaceId: Id<'workspaces'>
  unreadByChannel: Map<string, ChannelUnread>
}): React.JSX.Element {
  const dms = useQuery(api.dms.listMine, { workspaceId })
  const [composing, setComposing] = useState(false)

  return (
    <div className="mt-3">
      <div className="group/dm flex items-center gap-1 px-2 pt-1 pb-1">
        <span className="flex-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Direct messages
        </span>
        <button
          type="button"
          aria-label="New message"
          title="New message"
          onClick={() => setComposing(true)}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/dm:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:opacity-100"
        >
          <Plus className="size-3.5" weight="bold" />
        </button>
      </div>

      {dms && dms.length > 0 ? (
        dms.map((dm) => (
          <DmRow
            key={dm.channelId}
            dm={dm}
            serverId={serverId}
            unread={unreadByChannel.get(dm.channelId)}
          />
        ))
      ) : (
        // Not a spinner: this is a short list under the channel tree, and a brand-new
        // workspace legitimately has none. An empty line that explains the `+` beats
        // a placeholder that flickers.
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Plus className="size-4 shrink-0" />
          Start a conversation
        </button>
      )}

      <NewDmDialog
        workspaceId={workspaceId}
        serverId={serverId}
        open={composing}
        onOpenChange={setComposing}
      />
    </div>
  )
}

function DmRow({
  dm,
  serverId,
  unread
}: {
  dm: Dm
  serverId: string
  unread?: ChannelUnread
}): React.JSX.Element {
  const first = dm.others[0]
  // Live connectivity outranks the person's chosen status, exactly as in the member
  // list: someone who set Away and then quit reads as offline.
  const online = useIsOnline(first?.userId)
  const count = unread?.mentionCount ?? 0
  const hasUnread = Boolean(unread?.hasUnread)

  return (
    <Link
      to="/w/$workspaceId/d/$channelId"
      params={{ workspaceId: serverId, channelId: dm.channelId }}
      activeProps={{ className: 'bg-sidebar-accent font-medium text-sidebar-foreground' }}
      inactiveProps={{
        className: hasUnread ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground'
      }}
      className="flex items-center gap-2 rounded-md py-1 pr-2 pl-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      {dm.others.length > 1 ? (
        // Group DM: a count, not a stack of avatars — the row is one line tall and a
        // stack would either crowd the name or shrink to illegible.
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[10px] font-semibold text-muted-foreground">
          {dm.others.length + 1}
        </span>
      ) : (
        <Avatar
          initials={dmInitials(dm.others)}
          color={first?.color ?? FALLBACK_AVATAR_COLOR}
          image={first?.avatarUrl}
          presence={presenceWithConnectivity(first?.presence, online)}
          className="size-5 text-[9px]"
          ringClassName="ring-2 ring-sidebar"
        />
      )}
      <span className="min-w-0 flex-1 truncate">{dmTitle(dm.others)}</span>
      {count > 0 ? (
        <span
          className={cn(
            'flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground'
          )}
          title={`${count}${unread?.mentionsOverflow ? ' or more' : ''} unread message${
            count === 1 && !unread?.mentionsOverflow ? '' : 's'
          }`}
        >
          {count}
          {unread?.mentionsOverflow ? '+' : ''}
        </span>
      ) : null}
    </Link>
  )
}
