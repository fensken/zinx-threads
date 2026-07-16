import { useQuery } from 'convex-helpers/react/cache/hooks'
import { List, MagnifyingGlass, Users } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { IconButton } from '@renderer/components/common/icon-button'
import { SidebarToggle } from '@renderer/components/layout/sidebar-toggle'
import { RealChannelView } from '@renderer/components/chat/real-channel-view'
import { Spinner } from '@renderer/components/ui/spinner'
import { dmInitials, dmTitle } from '@renderer/lib/dm'
import { presenceWithConnectivity, STATUS_LABEL, normalizeStatus } from '@renderer/lib/user-status'
import { useIsOnline } from '@renderer/store/presence-store'
import { useUiStore } from '@renderer/store/ui-store'

/** A direct message: the same message view as a channel, with a header that shows
 *  the *people* instead of a channel name.
 *
 *  A DM is a `channels` row (`kind: 'dm'`), so `RealChannelView` renders it as-is —
 *  messages, replies, reactions, attachments, editing and the composer all come for
 *  free. What differs is deliberate: **no threads** (a thread is workspace-visible,
 *  a DM isn't — the server refuses one too), **no pinning or moderation** (nobody
 *  is an admin inside a conversation), and no members panel or channel settings.
 *
 *  The conversation is resolved out of the already-subscribed `dms.listMine`, so
 *  switching between DMs is instant instead of refetching — exactly how
 *  `RealChannelPage` resolves a channel from the sidebar's channel list. */
export function DmPage({
  serverId,
  channelId
}: {
  serverId: string
  channelId: string
}): React.JSX.Element {
  const resolved = useQuery(api.workspaces.getBySlug, { slug: serverId })
  const workspaceId = resolved?.workspace._id
  const dms = useQuery(api.dms.listMine, workspaceId ? { workspaceId } : 'skip')
  const channel = useQuery(api.channels.get, { channelId: channelId as Id<'channels'> })

  const dm = dms?.find((entry) => entry.channelId === channelId) ?? null
  const first = dm?.others[0]
  const online = useIsOnline(first?.userId)
  const togglePalette = useUiStore((s) => s.togglePalette)
  const setNavOpen = useUiStore((s) => s.setNavOpen)

  if (dms === undefined || channel === undefined) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }
  // `channels.get` returns null when the caller isn't a participant — the server's
  // `dmMembers` gate, surfaced honestly rather than as an empty conversation.
  if (!channel || channel.kind !== 'dm' || !dm) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-muted-foreground">
        Conversation not found.
      </div>
    )
  }

  const title = dmTitle(dm.others)
  const isGroup = dm.others.length > 1
  const subtitle = isGroup
    ? `${dm.others.length + 1} people`
    : first
      ? first.statusText || STATUS_LABEL[normalizeStatus(first.presence)]
      : ''

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <IconButton label="Open navigation" className="md:hidden" onClick={() => setNavOpen(true)}>
          <List className="size-5" />
        </IconButton>
        <SidebarToggle />

        {isGroup ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Users className="size-4" />
          </span>
        ) : (
          <Avatar
            initials={dmInitials(dm.others)}
            color={first?.color ?? FALLBACK_AVATAR_COLOR}
            image={first?.avatarUrl}
            presence={presenceWithConnectivity(first?.presence, online)}
            className="size-7 text-[10px]"
            ringClassName="ring-2 ring-card"
          />
        )}

        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{title}</span>
          {first?.statusEmoji && !isGroup ? (
            <span className="shrink-0 text-sm leading-none">{first.statusEmoji}</span>
          ) : null}
          {subtitle ? (
            <>
              <span className="mx-1 hidden h-4 w-px shrink-0 bg-border xl:block" />
              <span className="hidden truncate text-sm text-muted-foreground xl:block">
                {subtitle}
              </span>
            </>
          ) : null}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton label="Search" onClick={togglePalette}>
            <MagnifyingGlass className="size-5" />
          </IconButton>
        </div>
      </header>

      {/* Keyed per conversation so scroll position, draft reply and edit state reset.
          `canModerate` is false by construction — nobody moderates a DM (the server
          says so too), and `allowThreads` is off: threads are workspace-visible. */}
      <RealChannelView
        key={channel._id}
        channel={channel}
        canModerate={false}
        allowThreads={false}
        displayName={title}
      />
    </div>
  )
}
