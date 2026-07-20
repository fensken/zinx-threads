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
  Check,
  FolderOpen,
  LockSimple,
  MicrophoneSlash,
  PlugsConnected,
  PencilSimple,
  Plus,
  Scribble,
  Sliders,
  Trash,
  VideoCamera
} from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { Button } from '@renderer/components/ui/button'
import { DeafenGlyph } from '@renderer/components/voice/deafen-glyph'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { ChannelSettingsDialog } from '@renderer/components/chat/channel-settings-dialog'
import { PostingPolicyIcon } from '@renderer/components/chat/channel-policy-icon'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import {
  RowActionButton,
  SidebarGroup,
  SidebarRow
} from '@renderer/components/chat/sidebar-primitives'
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
import { ChannelListSkeleton } from '@renderer/components/common/skeletons'
import { PendingChannelInvites } from '@renderer/components/chat/pending-channel-invites'
import { SharedChannelsSection } from '@renderer/components/chat/shared-channels-section'
import { DmSection } from '@renderer/components/chat/dm-section'
import { CreateChannelDialog } from '@renderer/components/chat/create-channel-dialog'
import { RenameField } from '@renderer/components/chat/rename-field'
import { UserPanel } from '@renderer/components/common/user-panel'
import { useVoiceStore } from '@renderer/store/voice-store'
import { toSlug } from '@renderer/lib/slug'
import { cn } from '@renderer/lib/utils'

const UNGROUPED = '__ungrouped__'

type ChannelUnread = FunctionReturnType<typeof api.unread.listByWorkspace>[number]
type VoicePresence = FunctionReturnType<typeof api.voice.listByWorkspace>[number]
type SharedOut = FunctionReturnType<typeof api.sharedChannels.sharedFromWorkspace>[number]

const NO_PRESENCE: VoicePresence[] = []

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function channelIcon(kind: string, className: string): React.JSX.Element {
  // Single-sourced through `ChannelKindIcon` so a new kind can't render one glyph in the
  // sidebar and another in the header / `#` autocomplete.
  return <ChannelKindIcon kind={kind} className={className} />
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

  // Threads are NOT listed in the sidebar — the channel header's Threads button
  // (→ `ThreadsDialog`) is their only entry point. The row still *says how many* a
  // channel has, so counts (not rows) are all this needs.
  const threadCountData = useQuery(
    api.threads.countsByChannel,
    workspaceId ? { workspaceId } : 'skip'
  )
  const threadCounts = useMemo(
    () => new Map((threadCountData ?? []).map((entry) => [entry.channelId as string, entry.count])),
    [threadCountData]
  )

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
      {/* Fixed h-14 + border-b so the sidebar header lines up with the content and
          right-panel headers (all 3.5rem tall). */}
      <div className="flex h-14 shrink-0 items-center border-b px-2">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher serverId={serverId} />
        </div>
      </div>

      <SidebarQuickNav serverId={serverId} />

      {/* Channel-share invites for THIS workspace (in-app accept/decline). */}
      <PendingChannelInvites workspaceId={workspaceId} />

      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-2">
        {/* While the channel list is loading, a skeleton stands in for it — the empty
            DnD tree below renders nothing, so this is what shows. */}
        {channelsData === undefined ? <ChannelListSkeleton /> : null}

        {/* The home channel sits outside the DnD tree — it can't be dragged. */}
        {defaultChannel ? (
          <ChannelRow
            channel={defaultChannel}
            serverId={serverId}
            groups={groups}
            canManage={canManage}
            voice={presenceByChannel.get(defaultChannel._id) ?? NO_PRESENCE}
            unread={unreadByChannel.get(defaultChannel._id)}
            threadCount={threadCounts.get(defaultChannel._id)}
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
                    canManage={canManage}
                    voice={presenceByChannel.get(id) ?? NO_PRESENCE}
                    unread={unreadByChannel.get(id)}
                    threadCount={threadCounts.get(id)}
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
                  <ChannelGroup
                    group={g}
                    onAddChannel={() => setCreateIn({ groupId: g._id })}
                    onCreateGroup={() => setNewGroup('')}
                  >
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
                              canManage={canManage}
                              voice={presenceByChannel.get(id) ?? NO_PRESENCE}
                              unread={unreadByChannel.get(id)}
                              threadCount={threadCounts.get(id)}
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
              <div className="rounded-md bg-sidebar-accent px-2 py-1 text-[11px] font-semibold tracking-wide text-sidebar-foreground uppercase shadow-lg">
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNewGroup('')}
            className="mt-2 w-full justify-start gap-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Plus className="size-3.5" weight="bold" />
            New group
          </Button>
        )}

        {channelsData !== undefined && channels.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No channels yet — create one below.
          </p>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCreateIn({})}
          className="mt-1 w-full justify-start gap-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Plus className="size-3.5" weight="bold" />
          Add a channel
        </Button>

        {/* Channels another workspace shared into this one (guest side). */}
        {workspaceId ? (
          <SharedChannelsSection serverId={serverId} workspaceId={workspaceId} />
        ) : null}

        {/* Conversations, below the channel tree (Slack/Discord both put them last).
            They aren't channels — no group, no drag, no rename — so they're a section
            of their own rather than a bucket in the DnD tree. Unread comes from the
            `unread` subscription above; the DM list is its own. */}
        {workspaceId ? (
          <DmSection
            serverId={serverId}
            workspaceId={workspaceId}
            unreadByChannel={unreadByChannel}
          />
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

function ChannelRow({
  channel,
  serverId,
  groups,
  voice,
  unread,
  threadCount = 0,
  shared,
  nested,
  locked,
  canManage,
  onCreateChannel
}: {
  channel: Doc<'channels'>
  serverId: string
  groups: Doc<'channelGroups'>[]
  /** Members currently connected to this voice channel's call (empty otherwise). */
  voice: VoicePresence[]
  /** Absent when the channel is fully read (`unread.listByWorkspace` omits it). */
  unread?: ChannelUnread
  /** How many threads this channel has — a count badge, not a list. */
  threadCount?: number
  /** Set when this channel is shared out to another workspace (host side). */
  shared?: SharedOut
  nested?: boolean
  /** The workspace's home channel: rename only, no move / delete. */
  locked?: boolean
  /** Workspace owner/admin — may open the channel's settings (visibility + posting). */
  canManage?: boolean
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
  // Reading the channel clears it, so the active row never advertises unread.
  const hasUnread = !isActive && Boolean(unread?.hasUnread)
  const mentions = isActive ? 0 : (unread?.mentionCount ?? 0)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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
          <SidebarRow
            active={isActive}
            emphasized={hasUnread}
            nested={nested}
            reserve={(mentions > 0 ? 1 : 0) + (threadCount > 0 ? 1 : 0)}
            surface={(className) => (
              <Link {...linkProps} className={className}>
                {channelIcon(channel.kind, 'size-4 shrink-0 opacity-60')}
                <span className="truncate">{channel.name}</span>
                {/* Private: not everyone in the workspace can see this. The leading glyph is
                    the channel's KIND, so access lives here, beside the shared-out plug. */}
                {channel.visibility === 'private' ? (
                  <LockSimple
                    className="size-3 shrink-0 text-muted-foreground"
                    weight="fill"
                    aria-label="Private channel"
                  />
                ) : null}
                {/* Read-only for someone. The glyph must MATCH the policy — a megaphone on a
                    "specific people" channel says "announcement", which is the wrong answer
                    confidently. Both this and the settings dialog render it from one place. */}
                {channel.postingPolicy && channel.postingPolicy !== 'everyone' ? (
                  <PostingPolicyIcon
                    policy={channel.postingPolicy}
                    className="size-3 shrink-0 text-muted-foreground"
                    aria-label={
                      channel.postingPolicy === 'admins'
                        ? 'Only owners and admins can post'
                        : 'Only certain people can post'
                    }
                  />
                ) : null}
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
            )}
            hoverActions={
              <>
                <RowActionButton label="Rename channel" onClick={() => setEditing(true)}>
                  <PencilSimple className="size-3.5" />
                </RowActionButton>
                {!locked ? (
                  <RowActionButton label="Delete channel" onClick={() => setConfirmDelete(true)}>
                    <Trash className="size-3.5" />
                  </RowActionButton>
                ) : null}
              </>
            }
            badges={
              <>
                {/* How many threads this channel has. Purely informational — the sidebar
                    doesn't list them (the header's Threads dialog does), so this is a
                    count, not a disclosure. Muted, since colour is the mention pill's. */}
                {threadCount > 0 ? (
                  <span
                    className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-muted-foreground"
                    title={`${threadCount} thread${threadCount === 1 ? '' : 's'}`}
                  >
                    <Scribble className="size-3" />
                    {threadCount}
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
              </>
            }
          />
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
          {canManage ? (
            <ContextMenuItem onClick={() => setSettingsOpen(true)}>
              <Sliders className="text-muted-foreground" />
              Channel settings
            </ContextMenuItem>
          ) : null}
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

      {/* Discord-style: everyone connected to this voice channel, shown under it. */}
      {channel.kind === 'voice' && voice.length > 0 ? (
        <VoiceParticipants participants={voice} indent={nested ? 28 : 16} />
      ) : null}

      {canManage ? (
        <ChannelSettingsDialog
          channel={channel}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete #${channel.name}?`}
        description={
          <>
            This permanently deletes the channel and all its messages
            <span className="font-medium text-sidebar-foreground">
              , including any threads and their replies
            </span>
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
            className="flex items-center gap-2 rounded-md px-2 py-0.5 text-sidebar-foreground"
          >
            <span
              className={cn('shrink-0 rounded-full transition-shadow', speaking && 'speaking-ring')}
            >
              <Avatar
                initials={initialsOf(person.name)}
                color={person.color ?? FALLBACK_AVATAR_COLOR}
                image={person.avatarUrl}
                className="size-5"
              />
            </span>
            <span className={cn('min-w-0 flex-1 truncate text-xs', speaking && 'text-success')}>
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

function ChannelGroup({
  group,
  onAddChannel,
  onCreateGroup,
  children
}: {
  group: Doc<'channelGroups'>
  onAddChannel: () => void
  onCreateGroup: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const rename = useMutation(api.groups.rename)
  const remove = useMutation(api.groups.remove)
  return (
    <SidebarGroup
      name={group.name}
      addLabel="Create channel"
      deleteDescription="The group is removed, but its channels are kept — they move to the top, ungrouped."
      onRename={(name) => void rename({ groupId: group._id, name })}
      onDelete={async () => {
        await remove({ groupId: group._id })
      }}
      onAddChannel={onAddChannel}
      onCreateGroup={onCreateGroup}
    >
      {children}
    </SidebarGroup>
  )
}
