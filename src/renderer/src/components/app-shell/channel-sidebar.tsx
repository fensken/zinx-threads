import { useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowsLeftRight,
  CaretDown,
  CaretRight,
  ChatsCircle,
  FileText,
  Gear,
  Hash,
  Kanban,
  Lock,
  MagnifyingGlass,
  Plus,
  SpeakerHigh,
  Tray,
  UserPlus
} from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import {
  getChannel,
  getSidebarTree,
  getThreadsForChannel,
  type Channel,
  type ChannelKind,
  type GroupNode,
  type SidebarNode,
  type Thread
} from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'
import { useChannelName, useChannelStore } from '@renderer/store/channel-store'
import { useSidebarStore, type DragItem } from '@renderer/store/sidebar-store'
import { WorkspaceSwitcher } from './workspace-switcher'
import { UserPanel } from './user-panel'

function channelIcon(kind: ChannelKind, className: string): React.JSX.Element {
  switch (kind) {
    case 'voice':
      return <SpeakerHigh className={className} />
    case 'page':
      return <FileText className={className} />
    case 'kanban':
      return <Kanban className={className} />
    default:
      return <Hash className={className} />
  }
}

function nodeKey(node: SidebarNode): string {
  return node.type === 'group' ? node.id : node.channelId
}

function parseDrag(data: string): DragItem | null {
  const sep = data.indexOf(':')
  if (sep === -1) return null
  const kind = data.slice(0, sep)
  const id = data.slice(sep + 1)
  if (kind === 'ch') return { type: 'channel', id }
  if (kind === 'gr') return { type: 'group', id }
  return null
}

export function ChannelSidebar({ serverId }: { serverId: string }): React.JSX.Element {
  const storedTree = useSidebarStore((state) => state.trees[serverId])
  const tree = storedTree ?? getSidebarTree(serverId)
  const togglePalette = useUiStore((state) => state.togglePalette)
  const setInboxOpen = useUiStore((state) => state.setInboxOpen)
  const setThreadsOpen = useUiStore((state) => state.setThreadsOpen)

  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="p-2">
        <WorkspaceSwitcher serverId={serverId} />
      </div>

      <div className="space-y-0.5 px-2 pb-1">
        <QuickItem
          icon={<MagnifyingGlass className="size-5" />}
          label="Search"
          hint="⌘K"
          onClick={togglePalette}
        />
        <QuickItem
          icon={<Tray className="size-5" />}
          label="Inbox"
          onClick={() => setInboxOpen(true)}
        />
        <QuickItem
          icon={<ChatsCircle className="size-5" />}
          label="Threads"
          onClick={() => setThreadsOpen(true)}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-2">
        {tree.map((node) => (
          <TreeNode key={nodeKey(node)} node={node} serverId={serverId} depth={0} />
        ))}
      </div>

      <UserPanel />
    </div>
  )
}

function QuickItem({
  icon,
  label,
  hint,
  onClick
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
    >
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint ? (
        <kbd className="rounded bg-background/60 px-1 text-[10px] font-semibold text-muted-foreground">
          {hint}
        </kbd>
      ) : null}
    </button>
  )
}

function TreeNode({
  node,
  serverId,
  depth
}: {
  node: SidebarNode
  serverId: string
  depth: number
}): React.JSX.Element | null {
  if (node.type === 'group') return <TreeGroup node={node} serverId={serverId} depth={depth} />
  const channel = getChannel(serverId, node.channelId)
  if (!channel) return null
  return <ChannelRow channel={channel} depth={depth} />
}

function TreeGroup({
  node,
  serverId,
  depth
}: {
  node: GroupNode
  serverId: string
  depth: number
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const move = useSidebarStore((state) => state.move)
  const dragItem = useSidebarStore((state) => state.dragItem)
  const beginDrag = useSidebarStore((state) => state.beginDrag)
  const endDrag = useSidebarStore((state) => state.endDrag)
  const [isOver, setIsOver] = useState(false)

  const isSource = dragItem?.type === 'group' && dragItem.id === node.id
  const intoGroup = isOver && dragItem?.type === 'channel'
  const beforeGroup = isOver && dragItem?.type === 'group' && !isSource

  return (
    <div className={cn('relative mt-3 first:mt-1', isSource && 'opacity-40')}>
      {beforeGroup ? (
        <span className="pointer-events-none absolute -top-1 right-1 left-1 z-10 h-0.5 rounded-full bg-primary" />
      ) : null}
      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', 'gr:' + node.id)
          event.dataTransfer.effectAllowed = 'move'
          beginDrag({ type: 'group', id: node.id })
        }}
        onDragEnd={() => {
          endDrag()
          setIsOver(false)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setIsOver(true)
        }}
        onDragLeave={() => setIsOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsOver(false)
          const dragged = parseDrag(event.dataTransfer.getData('text/plain'))
          if (dragged) move(serverId, dragged, { type: 'group', id: node.id })
          endDrag()
        }}
        className={cn(
          'group/g flex items-center rounded-md',
          intoGroup && 'bg-primary/10 ring-1 ring-inset ring-primary/40'
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex flex-1 items-center gap-1 rounded py-1 pr-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {collapsed ? (
            <CaretRight className="size-3.5 shrink-0" />
          ) : (
            <CaretDown className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        <button
          type="button"
          title="Add channel"
          aria-label="Add channel"
          className="mr-1 flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:text-foreground group-hover/g:opacity-100"
        >
          <Plus className="size-4" weight="bold" />
        </button>
      </div>
      {!collapsed ? (
        <div className="mt-0.5 space-y-0.5">
          {node.children.map((child) => (
            <TreeNode key={nodeKey(child)} node={child} serverId={serverId} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ChannelRow({ channel, depth }: { channel: Channel; depth: number }): React.JSX.Element {
  const params = useParams({ strict: false })
  const move = useSidebarStore((state) => state.move)
  const dragItem = useSidebarStore((state) => state.dragItem)
  const beginDrag = useSidebarStore((state) => state.beginDrag)
  const endDrag = useSidebarStore((state) => state.endDrag)
  const [isOver, setIsOver] = useState(false)
  const isActive = params.channelId === channel.id
  const threads = channel.kind === 'voice' ? [] : getThreadsForChannel(channel.id)
  const pad = 8 + depth * 12
  const name = useChannelName(channel.id, channel.name)
  const renameChannel = useChannelStore((state) => state.renameChannel)
  const setNavOpen = useUiStore((state) => state.setNavOpen)
  const [renaming, setRenaming] = useState(false)
  const cancelRename = useRef(false)

  const inner = (
    <>
      {channel.private ? (
        <Lock className="size-4 shrink-0 opacity-60" />
      ) : (
        channelIcon(channel.kind, 'size-4 shrink-0 opacity-60')
      )}
      {channel.emoji ? (
        <span className="shrink-0 text-sm leading-none">{channel.emoji}</span>
      ) : null}
      <span
        className="truncate"
        onDoubleClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setRenaming(true)
        }}
      >
        {name}
      </span>
      {channel.shared ? (
        <ArrowsLeftRight className="size-3.5 shrink-0 text-primary" weight="bold" />
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {channel.mentions ? (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground group-hover:hidden">
            {channel.mentions}
          </span>
        ) : null}
        {!isActive && threads.length > 0 ? (
          <span
            className="flex items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground group-hover:hidden"
            title={`${threads.length} thread${threads.length === 1 ? '' : 's'}`}
          >
            <ChatsCircle className="size-3.5" />
            {threads.length}
          </span>
        ) : null}
        {channel.kind !== 'voice' ? (
          <span className="hidden items-center gap-0.5 group-hover:flex">
            <UserPlus className="size-4 opacity-70 hover:opacity-100" />
            <span
              role="button"
              tabIndex={0}
              title="Rename channel"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setRenaming(true)
              }}
              className="opacity-70 hover:opacity-100"
            >
              <Gear className="size-4" />
            </span>
          </span>
        ) : null}
      </span>
    </>
  )

  const base =
    'group relative flex items-center gap-1.5 rounded-lg py-1 pr-2 text-sm transition-colors'

  const row =
    channel.kind === 'voice' ? (
      <button
        type="button"
        style={{ paddingLeft: pad }}
        className={cn(
          base,
          'w-full text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
        )}
      >
        {inner}
      </button>
    ) : (
      <Link
        to="/w/$workspaceId/c/$channelId"
        params={{ workspaceId: channel.serverId, channelId: channel.id }}
        draggable={false}
        onClick={() => setNavOpen(false)}
        style={{ paddingLeft: pad }}
        className={base}
        inactiveProps={{
          className: channel.unread
            ? 'font-medium text-foreground hover:bg-sidebar-accent'
            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
        }}
        activeProps={{ className: 'bg-sidebar-accent font-medium text-foreground' }}
      >
        {inner}
      </Link>
    )

  if (renaming) {
    return (
      <div className="rounded-lg">
        <div
          className="flex items-center gap-1.5 rounded-lg bg-sidebar-accent py-1 pr-2"
          style={{ paddingLeft: pad }}
        >
          {channel.private ? (
            <Lock className="size-4 shrink-0 opacity-60" />
          ) : (
            channelIcon(channel.kind, 'size-4 shrink-0 opacity-60')
          )}
          <input
            autoFocus
            defaultValue={name}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                renameChannel(channel.id, event.currentTarget.value)
                setRenaming(false)
              } else if (event.key === 'Escape') {
                cancelRename.current = true
                setRenaming(false)
              }
            }}
            onBlur={(event) => {
              if (!cancelRename.current) renameChannel(channel.id, event.currentTarget.value)
              cancelRename.current = false
              setRenaming(false)
            }}
            className="w-full min-w-0 rounded bg-background px-1 py-0.5 text-sm text-foreground outline-none ring-1 ring-primary"
          />
        </div>
      </div>
    )
  }

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', 'ch:' + channel.id)
        event.dataTransfer.effectAllowed = 'move'
        beginDrag({ type: 'channel', id: channel.id })
      }}
      onDragEnd={() => {
        endDrag()
        setIsOver(false)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setIsOver(true)
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setIsOver(false)
        const dragged = parseDrag(event.dataTransfer.getData('text/plain'))
        if (dragged) move(channel.serverId, dragged, { type: 'channel', id: channel.id })
        endDrag()
      }}
      className={cn(
        'relative rounded-lg',
        dragItem?.type === 'channel' && dragItem.id === channel.id && 'opacity-40'
      )}
    >
      {isOver && dragItem && !(dragItem.type === 'channel' && dragItem.id === channel.id) ? (
        <span className="pointer-events-none absolute -top-px right-1 left-1 z-10 h-0.5 rounded-full bg-primary" />
      ) : null}
      {row}
      {isActive && threads.length > 0 ? <ThreadTree threads={threads} pad={pad} /> : null}
    </div>
  )
}

function ThreadTree({ threads, pad }: { threads: Thread[]; pad: number }): React.JSX.Element {
  const openThread = useUiStore((state) => state.openThread)
  const activeThreadId = useUiStore((state) => state.activeThreadId)

  return (
    <div
      className="my-0.5 flex flex-col border-l border-sidebar-foreground/20"
      style={{ marginLeft: pad + 8 }}
    >
      {threads.map((thread) => (
        <button
          key={thread.id}
          type="button"
          onClick={() => openThread(thread.id)}
          className={cn(
            'group/th flex items-center rounded-r-lg py-1 pr-2 text-[13px] transition-colors',
            activeThreadId === thread.id
              ? 'bg-sidebar-accent font-medium text-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
          )}
        >
          <span className="h-px w-2.5 shrink-0 bg-sidebar-foreground/30 transition-colors group-hover/th:bg-foreground/40" />
          <span className="ml-2 truncate">{thread.name}</span>
        </button>
      ))}
    </div>
  )
}
