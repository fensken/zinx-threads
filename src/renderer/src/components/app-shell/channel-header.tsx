import {
  ArrowsLeftRight,
  ChatsCircle,
  FileText,
  Hash,
  Kanban,
  List,
  Lock,
  MagnifyingGlass,
  Tray,
  Users
} from '@phosphor-icons/react'
import { getServer, type Channel } from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'
import { useChannelName } from '@renderer/store/channel-store'
import { IconButton } from './icon-button'
import { ThreadsPopover } from './threads-popover'
import { InboxPopover } from './inbox-popover'

export function ChannelHeader({ channel }: { channel: Channel }): React.JSX.Element {
  const memberListOpen = useUiStore((state) => state.memberListOpen)
  const activeThreadId = useUiStore((state) => state.activeThreadId)
  const toggleMemberList = useUiStore((state) => state.toggleMemberList)
  const threadsOpen = useUiStore((state) => state.threadsOpen)
  const setThreadsOpen = useUiStore((state) => state.setThreadsOpen)
  const inboxOpen = useUiStore((state) => state.inboxOpen)
  const setInboxOpen = useUiStore((state) => state.setInboxOpen)
  const togglePalette = useUiStore((state) => state.togglePalette)
  const setNavOpen = useUiStore((state) => state.setNavOpen)
  const name = useChannelName(channel.id, channel.name)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
      <IconButton
        label="Open navigation"
        className="relative top-1.5 lg:hidden"
        onClick={() => setNavOpen(true)}
      >
        <List className="size-5" />
      </IconButton>
      <div className="flex min-w-0 items-center gap-1.5">
        {channel.private ? (
          <Lock className="size-5 shrink-0 text-muted-foreground" />
        ) : channel.kind === 'page' ? (
          <FileText className="size-5 shrink-0 text-muted-foreground" />
        ) : channel.kind === 'kanban' ? (
          <Kanban className="size-5 shrink-0 text-muted-foreground" />
        ) : (
          <Hash className="size-5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-semibold text-foreground">{name}</span>
        {channel.shared ? (
          <SharedOrgs serverIds={[channel.serverId, ...channel.shared.withServerIds]} />
        ) : null}
        {channel.topic ? (
          <>
            <span className="mx-1 hidden h-4 w-px shrink-0 bg-border xl:block" />
            <span className="hidden truncate text-sm text-muted-foreground xl:block">
              {channel.topic}
            </span>
          </>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton label="Search" onClick={togglePalette}>
          <MagnifyingGlass className="size-5" />
        </IconButton>
        <div className="relative">
          <IconButton
            label="Threads"
            active={threadsOpen}
            onClick={() => setThreadsOpen(!threadsOpen)}
          >
            <ChatsCircle className="size-5" />
          </IconButton>
          <ThreadsPopover serverId={channel.serverId} />
        </div>
        <div className="relative">
          <IconButton label="Inbox" active={inboxOpen} onClick={() => setInboxOpen(!inboxOpen)}>
            <Tray className="size-5" />
          </IconButton>
          <InboxPopover />
        </div>
        <IconButton
          label="Members"
          active={memberListOpen && !activeThreadId}
          onClick={toggleMemberList}
        >
          <Users className="size-5" />
        </IconButton>
      </div>
    </header>
  )
}

function SharedOrgs({ serverIds }: { serverIds: string[] }): React.JSX.Element {
  return (
    <div
      className="ml-1 flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5"
      title="Shared channel"
    >
      <ArrowsLeftRight className="size-3.5 text-primary" weight="bold" />
      <span className="flex -space-x-1">
        {serverIds.map((id) => (
          <OrgChip key={id} id={id} />
        ))}
      </span>
    </div>
  )
}

function OrgChip({ id }: { id: string }): React.JSX.Element {
  const server = getServer(id)
  return (
    <span
      className="flex size-4 items-center justify-center rounded-full text-[8px] font-bold text-white ring-1 ring-card"
      style={{ backgroundColor: server?.color ?? '#888' }}
      title={server?.name}
    >
      {server?.initials}
    </span>
  )
}
