import { useState } from 'react'
import {
  CalendarDots,
  List,
  MagnifyingGlass,
  PushPin,
  Scribble,
  Sliders,
  Tray,
  Users
} from '@phosphor-icons/react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { errorMessage } from '@renderer/lib/convex-error'
import { useUiStore } from '@renderer/store/ui-store'
import { IconButton } from '@renderer/components/common/icon-button'
import { SidebarToggle } from '@renderer/components/layout/sidebar-toggle'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { ChannelSettingsDialog } from '@renderer/components/chat/channel-settings-dialog'
import { EditableChannelName } from '@renderer/components/chat/editable-channel-name'
import { NavFlyout } from '@renderer/components/chat/nav-flyout'
import { RealInboxList } from '@renderer/components/chat/real-inbox-list'
import { UpcomingEventsList } from '@renderer/components/events/upcoming-events-list'
import { ThreadsDialog } from '@renderer/components/chat/threads-dialog'
import { ChannelConnectionsDialog } from '@renderer/components/chat/share-channel-dialog'
import { ChannelConnectionPill } from '@renderer/components/chat/channel-connection-pill'

/** Convex-backed channel header — mirrors the demo `ChannelHeader`: hamburger
 *  (mobile), channel icon + name + topic, and the Search / Threads / Inbox /
 *  Members actions on the right. The name renames in place, exactly as in the
 *  sidebar. Threads/Inbox open header popovers (Inbox is a placeholder empty
 *  state until that backend lands); Members toggles the right panel. */
export function RealChannelHeader({
  channel,
  workspaceSlug,
  workspaceId,
  canManage = false
}: {
  channel: Doc<'channels'>
  workspaceSlug: string
  /** The workspace the caller views this channel through (their guest workspace for
   *  a shared channel) — needed so a guest can leave the connection. */
  workspaceId?: Id<'workspaces'>
  /** Owner/admin of the HOST workspace (not a guest) — may share + manage guests. */
  canManage?: boolean
}): React.JSX.Element {
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const memberListOpen = useUiStore((s) => s.memberListOpen)
  const toggleMemberList = useUiStore((s) => s.toggleMemberList)
  const threadsOpen = useUiStore((s) => s.threadsOpen)
  const setThreadsOpen = useUiStore((s) => s.setThreadsOpen)
  const inboxOpen = useUiStore((s) => s.inboxOpen)
  const setInboxOpen = useUiStore((s) => s.setInboxOpen)
  const eventsOpen = useUiStore((s) => s.eventsOpen)
  const setEventsOpen = useUiStore((s) => s.setEventsOpen)
  const togglePalette = useUiStore((s) => s.togglePalette)
  const setNavOpen = useUiStore((s) => s.setNavOpen)
  const pinnedOpen = useUiStore((s) => s.pinnedOpen)
  const setPinnedOpen = useUiStore((s) => s.setPinnedOpen)
  const rename = useMutation(api.channels.rename)
  // User-wide, not this workspace's: the badge answers "does anyone need me?", and
  // that question doesn't stop at a workspace boundary.
  const inboxUnread = useQuery(api.inbox.unreadCountForMe, {})
  // Threads are *browsed* from here, never started from here — you start one on a message.
  // So the button is an entry to a list, and a button that always opens an empty list is a
  // dead button. It appears only once this channel HAS threads. One workspace-wide
  // subscription that the sidebar's count badges already hold, so it costs no extra socket
  // work (Convex dedupes it).
  const threadCounts = useQuery(
    api.threads.countsByChannel,
    channel.kind === 'chat' ? { workspaceId: channel.workspaceId } : 'skip'
  )
  const threadCount = threadCounts?.find((entry) => entry.channelId === channel._id)?.count ?? 0
  const inboxBadge = inboxUnread
    ? inboxUnread.overflow
      ? `${inboxUnread.count}+`
      : inboxUnread.count > 0
        ? String(inboxUnread.count)
        : null
    : null

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
      <IconButton label="Open navigation" className="md:hidden" onClick={() => setNavOpen(true)}>
        <List className="size-5" />
      </IconButton>
      <SidebarToggle />
      <EditableChannelName
        name={channel.name}
        icon={
          <ChannelKindIcon kind={channel.kind} className="size-5 shrink-0 text-muted-foreground" />
        }
        onRename={(name) => {
          rename({ channelId: channel._id, name }).catch((error) => {
            toast.error(errorMessage(error, 'Could not rename the channel'))
          })
        }}
        trailing={
          <>
            {channel.topic ? (
              <>
                <span className="mx-1 hidden h-4 w-px shrink-0 bg-border xl:block" />
                <span className="hidden truncate text-sm text-muted-foreground xl:block">
                  {channel.topic}
                </span>
              </>
            ) : null}
            {channel.kind === 'chat' && !channel.isDefault ? (
              <ChannelConnectionPill
                channelId={channel._id}
                canManage={canManage}
                onOpen={() => setConnectionsOpen(true)}
              />
            ) : null}
          </>
        }
      />

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton label="Search" onClick={togglePalette}>
          <MagnifyingGlass className="size-5" />
        </IconButton>
        {channel.kind === 'chat' ? (
          <IconButton
            label="Pinned messages"
            active={pinnedOpen}
            onClick={() => setPinnedOpen(true)}
          >
            <PushPin className="size-5" />
          </IconButton>
        ) : null}
        {threadCount > 0 ? (
          <IconButton label="Threads" active={threadsOpen} onClick={() => setThreadsOpen(true)}>
            <Scribble className="size-5" />
          </IconButton>
        ) : null}
        <div className="relative">
          <IconButton
            label="Inbox"
            active={inboxOpen}
            className="relative"
            onClick={() => setInboxOpen(!inboxOpen)}
          >
            <Tray className="size-5" />
            {inboxBadge ? (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {inboxBadge}
              </span>
            ) : null}
          </IconButton>
          {inboxOpen ? (
            <NavFlyout
              title="Inbox"
              className="top-full right-0 mt-2"
              onClose={() => setInboxOpen(false)}
            >
              <RealInboxList workspaceSlug={workspaceSlug} onNavigate={() => setInboxOpen(false)} />
            </NavFlyout>
          ) : null}
        </div>

        {/* Events: the header peeks at what's coming up; the sidebar's Events row goes
            to the calendar. Same split as the Inbox. */}
        <div className="relative">
          <IconButton label="Events" active={eventsOpen} onClick={() => setEventsOpen(!eventsOpen)}>
            <CalendarDots className="size-5" />
          </IconButton>
          {eventsOpen ? (
            <NavFlyout
              title="Upcoming"
              className="top-full right-0 mt-2"
              onClose={() => setEventsOpen(false)}
            >
              <UpcomingEventsList
                workspaceId={channel.workspaceId}
                workspaceSlug={workspaceSlug}
                onNavigate={() => setEventsOpen(false)}
              />
            </NavFlyout>
          ) : null}
        </div>

        <IconButton label="Members" active={memberListOpen} onClick={toggleMemberList}>
          <Users className="size-5" />
        </IconButton>
        {canManage && channel.kind !== 'dm' ? (
          <IconButton
            label="Channel settings"
            active={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <Sliders className="size-5" />
          </IconButton>
        ) : null}
      </div>

      {/* Threads for THIS channel — the only entry point (they're no longer listed in
          the sidebar), shaped like the pinned-messages dialog. */}
      {threadCount > 0 ? (
        <ThreadsDialog
          workspaceId={channel.workspaceId}
          channelId={channel._id}
          channelName={channel.name}
          open={threadsOpen}
          onOpenChange={setThreadsOpen}
        />
      ) : null}

      {/* Who can see it, who can post in it, and the people list behind both. */}
      {canManage && channel.kind !== 'dm' ? (
        <ChannelSettingsDialog
          channel={channel}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      ) : null}

      {/* One dialog for both roles: owner invites/removes guests; a guest views the
          connected workspaces and can leave. */}
      {channel.kind === 'chat' && !channel.isDefault ? (
        <ChannelConnectionsDialog
          channelId={channel._id}
          channelName={channel.name}
          workspaceId={workspaceId}
          canManage={canManage}
          open={connectionsOpen}
          onOpenChange={setConnectionsOpen}
        />
      ) : null}
    </header>
  )
}
