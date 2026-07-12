import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import type { FunctionReturnType } from 'convex/server'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  CaretRight,
  Check,
  ChatsCircle,
  Copy,
  FileText,
  FolderOpen,
  Hash,
  Kanban,
  MicrophoneSlash,
  PlugsConnected,
  PencilSimple,
  Plus,
  SpeakerHigh,
  Trash,
  VideoCamera
} from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { Avatar } from '@renderer/components/common/avatar'
import { DeafenGlyph } from '@renderer/components/voice/deafen-glyph'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { WorkspaceSwitcher } from '@renderer/components/workspace/workspace-switcher'
import { SidebarQuickNav } from '@renderer/components/chat/sidebar-quick-nav'
import { PendingChannelInvites } from '@renderer/components/chat/pending-channel-invites'
import { SharedChannelsSection } from '@renderer/components/chat/shared-channels-section'
import { CreateChannelDialog } from '@renderer/components/chat/create-channel-dialog'
import { RenameField } from '@renderer/components/chat/rename-field'
import { UserPanel } from '@renderer/components/common/user-panel'
import { useUiStore } from '@renderer/store/ui-store'
import { useVoiceStore } from '@renderer/store/voice-store'
import { toSlug } from '@renderer/lib/slug'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { cn } from '@renderer/lib/utils'
import { toast } from 'sonner'

const UNGROUPED = '__ungrouped__'

type SidebarThread = FunctionReturnType<typeof api.threads.listByChannelForSidebar>[number]
type ChannelUnread = FunctionReturnType<typeof api.unread.listByWorkspace>[number]
type VoicePresence = FunctionReturnType<typeof api.voice.listByWorkspace>[number]
type SharedOut = FunctionReturnType<typeof api.sharedChannels.sharedFromWorkspace>[number]

const NO_THREADS: SidebarThread[] = []
const NO_PRESENCE: VoicePresence[] = []

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function channelIcon(kind: string, className: string): React.JSX.Element {
  if (kind === 'voice') return <SpeakerHigh className={className} />
  if (kind === 'page') return <FileText className={className} />
  if (kind === 'kanban') return <Kanban className={className} />
  return <Hash className={className} />
}

/** Right padding on a channel's `<Link>`, so its name truncates before it reaches
 *  the overlaid affordances. The hover actions reserve their width whether or not
 *  they're visible (they fade, they don't unmount), so only the always-visible
 *  badges change this. */
function trailingPad(threadBadge: boolean, mentionBadge: boolean): string {
  if (threadBadge && mentionBadge) return 'pr-28'
  if (threadBadge || mentionBadge) return 'pr-20'
  return 'pr-12'
}

/** Convex-backed sidebar for real workspaces: switcher + grouped channel list
 *  with full management (create/rename/delete + right-click context menus) and
 *  **@dnd-kit drag-and-drop** to reorder channels within/across groups and
 *  reorder groups (persisted via `channels.reorder`). Mirrors _zinx/Discord; the
 *  visual matches the mock sidebar. */
export function RealChannelSidebar({ serverId }: { serverId: string }): React.JSX.Element {
  const resolved = useQuery(api.workspaces.getBySlug, { slug: serverId })
  const groupsData = useQuery(api.groups.listBySlug, { slug: serverId })
  const channelsData = useQuery(api.channels.listBySlug, { slug: serverId })
  const groups = useMemo(() => groupsData ?? [], [groupsData])
  const channels = useMemo(() => channelsData ?? [], [channelsData])
  const createGroup = useMutation(api.groups.create)
  const reorder = useMutation(api.channels.reorder)

  const [createIn, setCreateIn] = useState<{ groupId?: Id<'channelGroups'> } | null>(null)
  const [newGroup, setNewGroup] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const workspaceId = resolved?.workspace._id

  const channelMap = useMemo(() => new Map(channels.map((c) => [c._id as string, c])), [channels])
  const groupMap = useMemo(() => new Map(groups.map((g) => [g._id as string, g])), [groups])

  // Threads nest under their channel (as the demo sidebar does). One
  // workspace-wide subscription rather than one per channel — every row renders
  // at once, and they all invalidate together anyway.
  const threadsData = useQuery(
    api.threads.listByChannelForSidebar,
    workspaceId ? { workspaceId } : 'skip'
  )
  const threadsByChannel = useMemo(() => {
    const map = new Map<string, SidebarThread[]>()
    for (const thread of threadsData ?? []) {
      const bucket = map.get(thread.channelId)
      if (bucket) bucket.push(thread)
      else map.set(thread.channelId, [thread])
    }
    return map
  }, [threadsData])

  // Unread state for the whole workspace in one subscription. `listByWorkspace`
  // omits channels with nothing unread, so a missing entry means "read".
  const unreadData = useQuery(api.unread.listByWorkspace, workspaceId ? { workspaceId } : 'skip')
  const unreadByChannel = useMemo(
    () => new Map((unreadData ?? []).map((entry) => [entry.channelId as string, entry])),
    [unreadData]
  )

  // Who's connected to each voice channel (Discord-style avatars under the row).
  const presenceData = useQuery(api.voice.listByWorkspace, workspaceId ? { workspaceId } : 'skip')
  const presenceByChannel = useMemo(() => {
    const map = new Map<string, VoicePresence[]>()
    for (const person of presenceData ?? []) {
      const bucket = map.get(person.channelId)
      if (bucket) bucket.push(person)
      else map.set(person.channelId, [person])
    }
    return map
  }, [presenceData])

  // Which of THIS workspace's channels are shared out to another workspace (host
  // side) — drives the "connected" glyph on the row. Guest-side shared channels
  // live in the separate "Shared with you" section below.
  const sharedOutData = useQuery(
    api.sharedChannels.sharedFromWorkspace,
    workspaceId ? { workspaceId } : 'skip'
  )
  const sharedByChannel = useMemo(
    () => new Map((sharedOutData ?? []).map((entry) => [entry.channelId as string, entry])),
    [sharedOutData]
  )

  // Local DnD order state, mirrored from the server. Keyed off a signature so it
  // only re-syncs when the actual data changes (not on every render, and not
  // mid-drag), letting optimistic drag updates stick until the mutation lands.
  const signature = useMemo(
    () =>
      JSON.stringify({
        g: [...groups].sort((a, b) => a.order - b.order).map((g) => g._id),
        c: channels.map((c) => `${c._id}:${c.groupId ?? ''}:${c.order}`).sort()
      }),
    [groups, channels]
  )
  // The workspace's home channel: rendered as a static row above the DnD tree, so
  // it can't be dragged into a group or reordered (the server rejects both too).
  const defaultChannel = useMemo(() => channels.find((c) => c.isDefault), [channels])

  const serverOrder = useMemo<{ groupIds: string[]; buckets: Record<string, string[]> }>(() => {
    const sortedGroups = [...groups].sort((a, b) => a.order - b.order)
    const bkts: Record<string, string[]> = {
      [UNGROUPED]: channels
        .filter((c) => !c.groupId && !c.isDefault)
        .sort((a, b) => a.order - b.order)
        .map((c) => c._id)
    }
    for (const g of sortedGroups) {
      bkts[g._id] = channels
        .filter((c) => c.groupId === g._id)
        .sort((a, b) => a.order - b.order)
        .map((c) => c._id)
    }
    return { groupIds: sortedGroups.map((g) => g._id), buckets: bkts }
  }, [groups, channels])

  // Local editable order, synced from the server only when the structural
  // signature changes — so mid-drag optimistic edits stick, and after a drop
  // `order` already matches what the mutation writes back (no snap-back flicker).
  // The sync is the sanctioned "mirror an external value into local state" case;
  // it's a single set, guarded by [signature], so it can't cascade.
  const [order, setOrder] = useState(serverOrder)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(serverOrder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
  // One-time backfill for workspaces created before the home channel existed.
  // `ensureDefault` is idempotent and owner/admin-gated, so this settles after a
  // single call and is a no-op for everyone else.
  const ensureDefault = useMutation(api.channels.ensureDefault)
  const canManage = resolved?.role === 'owner' || resolved?.role === 'admin'
  useEffect(() => {
    if (!workspaceId || !canManage) return
    if (channelsData === undefined || channelsData.some((c) => c.isDefault)) return
    void ensureDefault({ workspaceId }).catch(() => {})
  }, [workspaceId, canManage, channelsData, ensureDefault])

  const { groupIds, buckets } = order
  const setGroupIds = (gids: string[]): void => setOrder((o) => ({ ...o, groupIds: gids }))
  const setBuckets = (update: (b: Record<string, string[]>) => Record<string, string[]>): void =>
    setOrder((o) => ({ ...o, buckets: update(o.buckets) }))

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const activeType = activeId ? (groupMap.has(activeId) ? 'group' : 'channel') : null

  const findBucket = (id: string): string | undefined =>
    Object.keys(buckets).find((k) => buckets[k]?.includes(id))
  const bucketOf = (id: string): string | undefined =>
    id === UNGROUPED || groupMap.has(id) ? id : findBucket(id)

  const persist = (gids: string[], bkts: Record<string, string[]>): void => {
    if (!workspaceId) return
    const payload: { groupId?: Id<'channelGroups'>; channelIds: Id<'channels'>[] }[] = [
      { channelIds: (bkts[UNGROUPED] ?? []) as Id<'channels'>[] },
      ...gids.map((gid) => ({
        groupId: gid as Id<'channelGroups'>,
        channelIds: (bkts[gid] ?? []) as Id<'channels'>[]
      }))
    ]
    void reorder({
      workspaceId,
      groupOrder: gids as Id<'channelGroups'>[],
      buckets: payload
    })
  }

  const onDragStart = (e: DragStartEvent): void => setActiveId(String(e.active.id))

  const onDragOver = (e: DragOverEvent): void => {
    const { active, over } = e
    if (!over || activeType !== 'channel') return
    const a = String(active.id)
    const o = String(over.id)
    const from = findBucket(a)
    const to = bucketOf(o)
    if (!from || !to || from === to) return
    setBuckets((prev) => {
      const fromItems = (prev[from] ?? []).filter((id) => id !== a)
      const toItems = [...(prev[to] ?? [])]
      const overIndex = toItems.indexOf(o)
      toItems.splice(overIndex >= 0 ? overIndex : toItems.length, 0, a)
      return { ...prev, [from]: fromItems, [to]: toItems }
    })
  }

  const onDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    const a = String(active.id)
    const type = activeType
    setActiveId(null)
    if (!over) return
    const o = String(over.id)

    if (type === 'group') {
      const oldI = groupIds.indexOf(a)
      const newI = groupIds.indexOf(o)
      if (oldI >= 0 && newI >= 0 && oldI !== newI) {
        const next = arrayMove(groupIds, oldI, newI)
        setGroupIds(next)
        persist(next, buckets)
      }
      return
    }

    const bucket = findBucket(a)
    if (!bucket) {
      persist(groupIds, buckets)
      return
    }
    const items = buckets[bucket] ?? []
    const to = bucketOf(o)
    if (to === bucket) {
      const oldI = items.indexOf(a)
      const newI = o === bucket ? items.length - 1 : items.indexOf(o)
      if (oldI >= 0 && newI >= 0 && oldI !== newI) {
        const nextItems = arrayMove(items, oldI, newI)
        const next = { ...buckets, [bucket]: nextItems }
        setBuckets(() => next)
        persist(groupIds, next)
        return
      }
    }
    // Cross-bucket move was applied live in onDragOver — persist current state.
    persist(groupIds, buckets)
  }

  const submitNewGroup = async (): Promise<void> => {
    const name = (newGroup ?? '').trim()
    setNewGroup(null)
    if (name && workspaceId) await createGroup({ workspaceId, name })
  }

  const activeChannel = activeType === 'channel' && activeId ? channelMap.get(activeId) : undefined
  const activeGroup = activeType === 'group' && activeId ? groupMap.get(activeId) : undefined

  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="p-2">
        <WorkspaceSwitcher serverId={serverId} />
      </div>

      <SidebarQuickNav />

      {/* Channel-share invites for THIS workspace (in-app accept/decline). */}
      <PendingChannelInvites workspaceId={workspaceId} />

      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-2">
        {/* The home channel sits outside the DnD tree — it can't be dragged. */}
        {defaultChannel ? (
          <ChannelRow
            channel={defaultChannel}
            serverId={serverId}
            groups={groups}
            threads={threadsByChannel.get(defaultChannel._id) ?? NO_THREADS}
            voice={presenceByChannel.get(defaultChannel._id) ?? NO_PRESENCE}
            unread={unreadByChannel.get(defaultChannel._id)}
            shared={sharedByChannel.get(defaultChannel._id)}
            locked
            onCreateChannel={(groupId) => setCreateIn({ groupId })}
          />
        ) : null}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext items={buckets[UNGROUPED] ?? []} strategy={verticalListSortingStrategy}>
            {(buckets[UNGROUPED] ?? []).map((id) => {
              const ch = channelMap.get(id)
              return ch ? (
                <SortableChannel key={id} id={id}>
                  <ChannelRow
                    channel={ch}
                    serverId={serverId}
                    groups={groups}
                    threads={threadsByChannel.get(id) ?? NO_THREADS}
                    voice={presenceByChannel.get(id) ?? NO_PRESENCE}
                    unread={unreadByChannel.get(id)}
                    shared={sharedByChannel.get(id)}
                    onCreateChannel={(groupId) => setCreateIn({ groupId })}
                  />
                </SortableChannel>
              ) : null
            })}
          </SortableContext>

          <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
            {groupIds.map((gid) => {
              const g = groupMap.get(gid)
              if (!g) return null
              return (
                <SortableGroup key={gid} id={gid}>
                  <ChannelGroup group={g} onAddChannel={() => setCreateIn({ groupId: g._id })}>
                    <SortableContext
                      items={buckets[gid] ?? []}
                      strategy={verticalListSortingStrategy}
                    >
                      {(buckets[gid] ?? []).map((id) => {
                        const ch = channelMap.get(id)
                        return ch ? (
                          <SortableChannel key={id} id={id}>
                            <ChannelRow
                              channel={ch}
                              serverId={serverId}
                              groups={groups}
                              threads={threadsByChannel.get(id) ?? NO_THREADS}
                              voice={presenceByChannel.get(id) ?? NO_PRESENCE}
                              unread={unreadByChannel.get(id)}
                              shared={sharedByChannel.get(id)}
                              nested
                              onCreateChannel={(groupId) => setCreateIn({ groupId })}
                            />
                          </SortableChannel>
                        ) : null
                      })}
                    </SortableContext>
                  </ChannelGroup>
                </SortableGroup>
              )
            })}
          </SortableContext>

          <DragOverlay>
            {activeChannel ? (
              <div className="flex items-center gap-1.5 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm shadow-lg">
                {channelIcon(activeChannel.kind, 'size-4 text-muted-foreground')}
                <span className="truncate">{activeChannel.name}</span>
              </div>
            ) : activeGroup ? (
              <div className="rounded-md bg-sidebar-accent px-2 py-1 text-[11px] font-semibold tracking-wide text-foreground uppercase shadow-lg">
                {activeGroup.name}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {newGroup !== null ? (
          <input
            autoFocus
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            onBlur={submitNewGroup}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewGroup()
              if (e.key === 'Escape') setNewGroup(null)
            }}
            placeholder="New group name…"
            className="mt-2 h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:border-ring"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNewGroup('')}
            className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Plus className="size-3.5" weight="bold" />
            New group
          </button>
        )}

        {channels.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No channels yet — create one below.
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => setCreateIn({})}
          className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <Plus className="size-3.5" weight="bold" />
          Add a channel
        </button>

        {/* Channels another workspace shared into this one (guest side). */}
        {workspaceId ? (
          <SharedChannelsSection serverId={serverId} workspaceId={workspaceId} />
        ) : null}
      </div>

      <UserPanel />

      {workspaceId ? (
        <CreateChannelDialog
          workspaceId={workspaceId}
          workspaceSlug={serverId}
          groupId={createIn?.groupId}
          open={createIn !== null}
          onOpenChange={(open) => setCreateIn(open ? (createIn ?? {}) : null)}
        />
      ) : null}
    </div>
  )
}

/** Sortable wrapper for a channel row (whole row is the drag handle; a 6px
 *  activation distance keeps clicks/right-clicks working). */
function SortableChannel({
  id,
  children
}: {
  id: string
  children: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
    id
  })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}

/** Sortable wrapper for a group (its header is the drag handle). */
function SortableGroup({
  id,
  children
}: {
  id: string
  children: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({
    id
  })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}

function RowActionButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-background/40 hover:text-foreground"
    >
      {children}
    </button>
  )
}

function ChannelRow({
  channel,
  serverId,
  groups,
  threads,
  voice,
  unread,
  shared,
  nested,
  locked,
  onCreateChannel
}: {
  channel: Doc<'channels'>
  serverId: string
  groups: Doc<'channelGroups'>[]
  /** This channel's threads — expanded under the active row, badged otherwise. */
  threads: SidebarThread[]
  /** Members currently connected to this voice channel's call (empty otherwise). */
  voice: VoicePresence[]
  /** Absent when the channel is fully read (`unread.listByWorkspace` omits it). */
  unread?: ChannelUnread
  /** Set when this channel is shared out to another workspace (host side). */
  shared?: SharedOut
  nested?: boolean
  /** The workspace's home channel: rename only, no move / delete. */
  locked?: boolean
  onCreateChannel: (groupId?: Id<'channelGroups'>) => void
}): React.JSX.Element {
  const rename = useMutation(api.channels.rename)
  const remove = useMutation(api.channels.remove)
  const move = useMutation(api.channels.move)
  const markRead = useMutation(api.unread.markRead)
  const navigate = useNavigate()
  // `strict: false` — the sidebar also renders on routes with no channel param.
  const params = useParams({ strict: false })
  // Active on either URL form: the readable slug (`channelSlug` = name) or the by-id
  // permalink (`channelId`).
  const isActive = params.channelSlug === channel.name || params.channelId === channel._id
  const showBadge = !isActive && threads.length > 0
  // Reading the channel clears it, so the active row never advertises unread.
  const hasUnread = !isActive && Boolean(unread?.hasUnread)
  const mentions = isActive ? 0 : (unread?.mentionCount ?? 0)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Slug URL: grouped → /w/<ws>/g/<group>/<name>, ungrouped → /w/<ws>/<name>.
  const group = channel.groupId ? groups.find((g) => g._id === channel.groupId) : undefined
  const linkProps = group
    ? ({
        to: '/w/$workspaceId/g/$groupSlug/$channelSlug',
        params: { workspaceId: serverId, groupSlug: toSlug(group.name), channelSlug: channel.name }
      } as const)
    : ({
        to: '/w/$workspaceId/$channelSlug',
        params: { workspaceId: serverId, channelSlug: channel.name }
      } as const)

  if (editing) {
    return (
      <RenameField
        initial={channel.name}
        className="bg-sidebar-accent"
        leading={channelIcon(channel.kind, 'size-4 shrink-0 text-muted-foreground')}
        onCancel={() => setEditing(false)}
        onSubmit={(name) => {
          const clean = name.trim()
          if (clean && clean !== channel.name) void rename({ channelId: channel._id, name: clean })
          setEditing(false)
        }}
      />
    )
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <div className="group/ch relative flex items-center">
            <Link
              {...linkProps}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
                nested ? 'pl-5' : 'pl-2',
                // Reserve room for the overlaid affordances on the right. The
                // hover actions always occupy their width (they only fade in), so
                // this only grows with the always-visible badges.
                trailingPad(showBadge, mentions > 0),
                // Active/unread styling is computed from the params (not the Link's
                // own active state) so it holds for either URL form. Unread reads as
                // weight + full-contrast text; colour is reserved for the mention pill.
                isActive
                  ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                  : hasUnread
                    ? 'font-medium text-sidebar-foreground'
                    : 'text-sidebar-foreground/80'
              )}
            >
              {channelIcon(channel.kind, 'size-4 shrink-0 opacity-60')}
              {channel.emoji ? (
                <span className="shrink-0 text-sm leading-none">{channel.emoji}</span>
              ) : null}
              <span className="truncate">{channel.name}</span>
              {/* Connected glyph — this channel is shared out to another workspace
                  (primary once accepted, muted while an invite is pending). */}
              {shared && (shared.accepted > 0 || shared.pending > 0) ? (
                <PlugsConnected
                  className={cn(
                    'size-3 shrink-0',
                    shared.accepted > 0 ? 'text-primary' : 'text-muted-foreground'
                  )}
                  weight="bold"
                  aria-label={shared.accepted > 0 ? 'Shared channel' : 'Share pending'}
                />
              ) : null}
            </Link>

            {/* One right-anchored cluster: the always-visible badges sit at the very
                end of the row and the hover-only actions fade in to their left, so
                nothing the reader can normally see ever moves or gets covered. The
                active channel lists its threads below instead of counting them. */}
            <div className="pointer-events-none absolute right-1 flex items-center gap-1">
              <div className="pointer-events-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/ch:opacity-100">
                <RowActionButton label="Rename channel" onClick={() => setEditing(true)}>
                  <PencilSimple className="size-3.5" />
                </RowActionButton>
                {!locked ? (
                  <RowActionButton label="Delete channel" onClick={() => setConfirmDelete(true)}>
                    <Trash className="size-3.5" />
                  </RowActionButton>
                ) : null}
              </div>

              {showBadge ? (
                <span
                  className="flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground"
                  title={`${threads.length} thread${threads.length === 1 ? '' : 's'}`}
                >
                  <ChatsCircle className="size-3.5" />
                  {threads.length}
                </span>
              ) : null}

              {mentions > 0 ? (
                <span
                  className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
                  title={`${mentions}${unread?.mentionsOverflow ? ' or more' : ''} mention${mentions === 1 && !unread?.mentionsOverflow ? '' : 's'}`}
                >
                  {mentions}
                  {unread?.mentionsOverflow ? '+' : ''}
                </span>
              ) : null}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          {/* Discord's first item on an unread channel, and hidden once it's read
              rather than shown disabled — a menu item that can't do anything is
              noise. Omitting `upTo` marks read up to now. */}
          {hasUnread ? (
            <>
              <ContextMenuItem onClick={() => void markRead({ channelId: channel._id })}>
                <Check className="text-muted-foreground" weight="bold" />
                Mark as read
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : null}
          <ContextMenuItem onClick={() => onCreateChannel(channel.groupId)}>
            <Plus className="text-muted-foreground" weight="bold" />
            Create channel
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => setEditing(true)}>
            <PencilSimple className="text-muted-foreground" />
            Rename channel
          </ContextMenuItem>
          {/* The home channel is rename-only — no Move to, no Delete. */}
          {!locked ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderOpen className="text-muted-foreground" />
                Move to
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-44">
                <ContextMenuItem
                  disabled={!channel.groupId}
                  onClick={() =>
                    void move({ channelId: channel._id, groupId: undefined, order: 999 })
                  }
                >
                  Ungrouped (top)
                </ContextMenuItem>
                {groups.length ? <ContextMenuSeparator /> : null}
                {groups.map((g) => (
                  <ContextMenuItem
                    key={g._id}
                    disabled={channel.groupId === g._id}
                    onClick={() =>
                      void move({ channelId: channel._id, groupId: g._id, order: 999 })
                    }
                  >
                    {g.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          <ContextMenuItem
            onClick={() =>
              void copyToClipboard(channel._id).then((ok) => {
                if (ok) toast.success('Channel ID copied')
              })
            }
          >
            <Copy className="text-muted-foreground" />
            Copy channel ID
          </ContextMenuItem>
          {!locked ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash />
                Delete channel
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>

      {isActive && threads.length > 0 ? (
        <ThreadTree threads={threads} indent={nested ? 28 : 16} />
      ) : null}

      {/* Discord-style: everyone connected to this voice channel, shown under it. */}
      {channel.kind === 'voice' && voice.length > 0 ? (
        <VoiceParticipants participants={voice} indent={nested ? 28 : 16} />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete #${channel.name}?`}
        description={
          <>
            This permanently deletes the channel and all its messages
            {threads.length > 0 ? (
              <span className="font-medium text-foreground">
                , including its {threads.length} thread{threads.length === 1 ? '' : 's'} and their
                replies
              </span>
            ) : null}
            . This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete channel"
        onConfirm={async () => {
          await remove({ channelId: channel._id })
          await navigate({ to: '/w/$workspaceId', params: { workspaceId: serverId } })
        }}
      />
    </>
  )
}

/** The members connected to a voice channel's call, listed under the row
 *  (Discord-style) — a small avatar + name each. */
function VoiceParticipants({
  participants,
  indent
}: {
  participants: VoicePresence[]
  indent: number
}): React.JSX.Element {
  // Glow whoever's talking (only for the call YOU'RE in — that's the room LiveKit
  // gives us speaker events for; other channels show static avatars).
  const speakingUserIds = useVoiceStore((state) => state.speakingUserIds)
  return (
    <div className="mt-0.5 mb-1 space-y-0.5" style={{ paddingLeft: indent }}>
      {participants.map((person) => {
        const speaking = speakingUserIds.includes(person.userId)
        return (
          <div
            key={person.userId}
            className="flex items-center gap-2 rounded-md px-2 py-0.5 text-sidebar-foreground/80"
          >
            <span
              className={cn(
                'shrink-0 rounded-full transition-shadow',
                speaking && 'shadow-[0_0_0_2px_#10b981]'
              )}
            >
              <Avatar
                initials={initialsOf(person.name)}
                color={person.color ?? '#5865f2'}
                image={person.avatarUrl}
                className="size-5"
              />
            </span>
            <span className={cn('min-w-0 flex-1 truncate text-xs', speaking && 'text-emerald-500')}>
              {person.name}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {person.videoOn ? (
                <VideoCamera className="size-3.5 text-muted-foreground" weight="fill" />
              ) : null}
              {person.screenSharing ? (
                <span className="rounded bg-destructive px-1 text-[9px] font-bold tracking-wide text-destructive-foreground uppercase">
                  Live
                </span>
              ) : null}
              {person.deafened ? (
                <DeafenGlyph deafened className="size-3.5 text-destructive" />
              ) : person.muted ? (
                <MicrophoneSlash className="size-3.5 text-destructive" weight="fill" />
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The active channel's threads, nested beneath it — ported 1:1 from the demo
 *  sidebar's `ThreadTree`. Clicking one opens it in the right panel. */
function ThreadTree({
  threads,
  indent
}: {
  threads: SidebarThread[]
  indent: number
}): React.JSX.Element {
  const openThread = useUiStore((state) => state.openThread)
  const activeThreadId = useUiStore((state) => state.activeThreadId)

  return (
    <div
      className="my-0.5 flex flex-col border-l border-sidebar-foreground/20"
      style={{ marginLeft: indent }}
    >
      {threads.map((thread) => (
        <button
          key={thread._id}
          type="button"
          onClick={() => openThread(thread._id)}
          className={cn(
            'group/th flex items-center rounded-r-lg py-1 pr-2 text-[13px] transition-colors',
            activeThreadId === thread._id
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

function ChannelGroup({
  group,
  onAddChannel,
  children
}: {
  group: Doc<'channelGroups'>
  onAddChannel: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const rename = useMutation(api.groups.rename)
  const remove = useMutation(api.groups.remove)
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="mt-2">
      {editing ? (
        <RenameField
          initial={group.name}
          className="bg-sidebar-accent"
          onCancel={() => setEditing(false)}
          onSubmit={(name) => {
            const clean = name.trim()
            if (clean && clean !== group.name) void rename({ groupId: group._id, name: clean })
            setEditing(false)
          }}
        />
      ) : (
        <ContextMenu>
          <ContextMenuTrigger>
            <div className="group/grp flex items-center gap-0.5 px-1">
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                className="flex min-w-0 flex-1 items-center gap-1 rounded py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <CaretRight
                  className={cn(
                    'size-3.5 shrink-0 transition-transform',
                    !collapsed && 'rotate-90'
                  )}
                />
                <span className="truncate">{group.name}</span>
              </button>
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/grp:opacity-100">
                <RowActionButton label="Rename group" onClick={() => setEditing(true)}>
                  <PencilSimple className="size-3.5" />
                </RowActionButton>
                <RowActionButton label="Delete group" onClick={() => setConfirmDelete(true)}>
                  <Trash className="size-3.5" />
                </RowActionButton>
                <RowActionButton label={`Add channel to ${group.name}`} onClick={onAddChannel}>
                  <Plus className="size-3.5" weight="bold" />
                </RowActionButton>
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            <ContextMenuItem onClick={onAddChannel}>
              <Plus className="text-muted-foreground" weight="bold" />
              Create channel
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setEditing(true)}>
              <PencilSimple className="text-muted-foreground" />
              Rename group
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setCollapsed((c) => !c)}>
              <CaretRight className={cn('text-muted-foreground', !collapsed && 'rotate-90')} />
              {collapsed ? 'Expand group' : 'Collapse group'}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash />
              Delete group
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      <div className={collapsed ? 'hidden' : undefined}>{children}</div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete the "${group.name}" group?`}
        description="The group is removed, but its channels are kept — they move to the top, ungrouped."
        confirmLabel="Delete group"
        onConfirm={async () => {
          await remove({ groupId: group._id })
        }}
      />
    </div>
  )
}
