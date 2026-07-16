import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
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
import { FolderOpen, MagnifyingGlass, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import {
  LOCAL_UNGROUPED,
  useLocalStore,
  type LocalChannel,
  type LocalGroup
} from '@renderer/store/local-store'
import { RenameField } from '@renderer/components/chat/rename-field'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import {
  RowActionButton,
  SidebarGroup,
  SidebarRow
} from '@renderer/components/chat/sidebar-primitives'
import { QuickItem } from '@renderer/components/chat/sidebar-quick-nav'
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
import { LocalWorkspaceSwitcher } from '@renderer/components/local/local-workspace-switcher'
import { LocalUserBar } from '@renderer/components/local/local-user-bar'
import { LocalCreateChannelDialog } from '@renderer/components/local/local-create-channel-dialog'
import { useLocalUiStore } from '@renderer/store/local-ui-store'

const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
const SEARCH_SHORTCUT = IS_MAC ? '⌘ + K' : 'Ctrl + K'

/** Sidebar for the offline workspace — the SAME layout + behaviour as the live one
 *  (ungrouped channels + collapsible groups, drag-and-drop reorder/move, search,
 *  create/rename/delete + right-click menus), minus the online-only parts (members,
 *  chat/voice, unread, threads, shared channels, account). Driven entirely by the
 *  local store. */
export function LocalSidebar(): React.JSX.Element {
  const currentWorkspaceId = useLocalStore((state) => state.currentWorkspaceId)
  const allChannels = useLocalStore((state) => state.channels)
  const allGroups = useLocalStore((state) => state.groups)
  const createGroup = useLocalStore((state) => state.createGroup)
  const reorderSidebar = useLocalStore((state) => state.reorderSidebar)

  // The sidebar only shows the ACTIVE offline workspace's channels + groups.
  const channels = useMemo(
    () => allChannels.filter((c) => c.workspaceId === currentWorkspaceId),
    [allChannels, currentWorkspaceId]
  )
  const groups = useMemo(
    () => allGroups.filter((g) => g.workspaceId === currentWorkspaceId),
    [allGroups, currentWorkspaceId]
  )

  const [createIn, setCreateIn] = useState<{ groupId?: string } | null>(null)
  const [newGroup, setNewGroup] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const paletteOpen = useLocalUiStore((state) => state.paletteOpen)
  const setPaletteOpen = useLocalUiStore((state) => state.setPaletteOpen)
  const togglePalette = useLocalUiStore((state) => state.togglePalette)

  // ⌘K / Ctrl+K opens the command palette — the SAME modal the online app uses.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])

  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels])
  const groupMap = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])

  // Local editable order, mirrored from the store only when the structural signature
  // changes — so mid-drag optimistic edits stick and the drop doesn't snap back (same
  // pattern as the live sidebar). The store echoes synchronously after reorderSidebar.
  const signature = useMemo(
    () =>
      JSON.stringify({
        g: [...groups].sort((a, b) => a.order - b.order).map((g) => g.id),
        c: channels.map((c) => `${c.id}:${c.groupId ?? ''}:${c.order}`).sort()
      }),
    [groups, channels]
  )
  const storeOrder = useMemo<{ groupIds: string[]; buckets: Record<string, string[]> }>(() => {
    const sortedGroups = [...groups].sort((a, b) => a.order - b.order)
    const buckets: Record<string, string[]> = {
      [LOCAL_UNGROUPED]: channels
        .filter((c) => !c.groupId)
        .sort((a, b) => a.order - b.order)
        .map((c) => c.id)
    }
    for (const g of sortedGroups) {
      buckets[g.id] = channels
        .filter((c) => c.groupId === g.id)
        .sort((a, b) => a.order - b.order)
        .map((c) => c.id)
    }
    return { groupIds: sortedGroups.map((g) => g.id), buckets }
  }, [groups, channels])

  const [order, setOrder] = useState(storeOrder)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(storeOrder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const { groupIds, buckets } = order
  const setGroupIds = (gids: string[]): void => setOrder((o) => ({ ...o, groupIds: gids }))
  const setBuckets = (update: (b: Record<string, string[]>) => Record<string, string[]>): void =>
    setOrder((o) => ({ ...o, buckets: update(o.buckets) }))

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const activeType = activeId ? (groupMap.has(activeId) ? 'group' : 'channel') : null

  const findBucket = (id: string): string | undefined =>
    Object.keys(buckets).find((k) => buckets[k]?.includes(id))
  const bucketOf = (id: string): string | undefined =>
    id === LOCAL_UNGROUPED || groupMap.has(id) ? id : findBucket(id)

  const persist = (gids: string[], bkts: Record<string, string[]>): void => {
    reorderSidebar({ groupIds: gids, buckets: bkts })
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
    persist(groupIds, buckets)
  }

  const submitNewGroup = (): void => {
    const name = (newGroup ?? '').trim()
    setNewGroup(null)
    if (name) createGroup(name)
  }

  const activeChannel = activeType === 'channel' && activeId ? channelMap.get(activeId) : undefined
  const activeGroup = activeType === 'group' && activeId ? groupMap.get(activeId) : undefined

  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Header — offline workspace switcher (same shape + h-14 as the live one). */}
      <div className="flex h-14 shrink-0 items-center border-b px-2">
        <div className="min-w-0 flex-1">
          <LocalWorkspaceSwitcher />
        </div>
      </div>

      {/* Quick nav — the SAME block as the online sidebar (`SidebarQuickNav`), down to the
          container padding + the shared `QuickItem`. Offline only shows **Search**: Inbox and
          Events need a server, so they're hidden — not restyled. Matching the online container
          (`px-2 pb-1 py-2`) is what gives it the same breathing room. */}
      <div className="relative space-y-0.5 px-2 py-2 pb-1">
        <QuickItem
          icon={<MagnifyingGlass className="size-4" />}
          label="Search"
          hint={SEARCH_SHORTCUT}
          active={paletteOpen}
          onClick={togglePalette}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext
            items={buckets[LOCAL_UNGROUPED] ?? []}
            strategy={verticalListSortingStrategy}
          >
            {(buckets[LOCAL_UNGROUPED] ?? []).map((id) => {
              const ch = channelMap.get(id)
              return ch ? (
                <SortableItem key={id} id={id}>
                  <ChannelRow channel={ch} groups={groups} />
                </SortableItem>
              ) : null
            })}
          </SortableContext>

          <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
            {groupIds.map((gid) => {
              const g = groupMap.get(gid)
              if (!g) return null
              return (
                <SortableItem key={gid} id={gid}>
                  <ChannelGroup group={g} onAddChannel={() => setCreateIn({ groupId: g.id })}>
                    <SortableContext
                      items={buckets[gid] ?? []}
                      strategy={verticalListSortingStrategy}
                    >
                      {(buckets[gid] ?? []).map((id) => {
                        const ch = channelMap.get(id)
                        return ch ? (
                          <SortableItem key={id} id={id}>
                            <ChannelRow channel={ch} groups={groups} nested />
                          </SortableItem>
                        ) : null
                      })}
                    </SortableContext>
                  </ChannelGroup>
                </SortableItem>
              )
            })}
          </SortableContext>

          <DragOverlay>
            {activeChannel ? (
              <div className="flex items-center gap-1.5 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm shadow-lg">
                <ChannelKindIcon
                  kind={activeChannel.kind}
                  className="size-4 text-muted-foreground"
                />
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
              if (e.key === 'Enter') submitNewGroup()
              if (e.key === 'Escape') setNewGroup(null)
            }}
            placeholder="New group name…"
            className="mt-2 h-7 w-full rounded-md border border-input bg-transparent px-2 text-xs outline-none focus:border-ring"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNewGroup('')}
            className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Plus className="size-3.5" weight="bold" />
            New group
          </button>
        )}

        {channels.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No pages or boards yet — create one below.
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => setCreateIn({})}
          className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Plus className="size-3.5" weight="bold" />
          Add a page or board
        </button>
      </div>

      {/* Floating user bar — same shape as the online one; shows the offline profile. */}
      <LocalUserBar />

      <LocalCreateChannelDialog
        groupId={createIn?.groupId}
        open={createIn !== null}
        onOpenChange={(open) => setCreateIn(open ? (createIn ?? {}) : null)}
      />
    </div>
  )
}

/** Sortable wrapper — the whole element is the drag handle; a 6px activation distance
 *  keeps clicks/right-clicks working (shared by channel rows and group headers). */
function SortableItem({
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

function ChannelRow({
  channel,
  groups,
  nested
}: {
  channel: LocalChannel
  groups: LocalGroup[]
  nested?: boolean
}): React.JSX.Element {
  const rename = useLocalStore((state) => state.renameChannel)
  const remove = useLocalStore((state) => state.deleteChannel)
  const move = useLocalStore((state) => state.moveChannel)
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { channelId?: string }
  const isActive = params.channelId === channel.id
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (editing) {
    return (
      <RenameField
        initial={channel.name}
        className="bg-sidebar-accent"
        leading={
          <ChannelKindIcon kind={channel.kind} className="size-4 shrink-0 text-muted-foreground" />
        }
        onCancel={() => setEditing(false)}
        onSubmit={(name) => {
          const clean = name.trim()
          if (clean && clean !== channel.name) rename(channel.id, clean)
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
            nested={nested}
            surface={(className) => (
              <Link to="/local/$channelId" params={{ channelId: channel.id }} className={className}>
                <ChannelKindIcon kind={channel.kind} className="size-4 shrink-0 opacity-60" />
                <span className="truncate">{channel.name}</span>
              </Link>
            )}
            hoverActions={
              <>
                <RowActionButton label="Rename" onClick={() => setEditing(true)}>
                  <PencilSimple className="size-3.5" />
                </RowActionButton>
                <RowActionButton label="Delete" onClick={() => setConfirmDelete(true)}>
                  <Trash className="size-3.5" />
                </RowActionButton>
              </>
            }
          />
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onClick={() => setEditing(true)}>
            <PencilSimple className="text-muted-foreground" />
            Rename
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderOpen className="text-muted-foreground" />
              Move to
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-44">
              <ContextMenuItem
                disabled={!channel.groupId}
                onClick={() => move(channel.id, undefined)}
              >
                Ungrouped (top)
              </ContextMenuItem>
              {groups.length ? <ContextMenuSeparator /> : null}
              {groups.map((g) => (
                <ContextMenuItem
                  key={g.id}
                  disabled={channel.groupId === g.id}
                  onClick={() => move(channel.id, g.id)}
                >
                  {g.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${channel.name}?`}
        description="This permanently removes it from this device. This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (isActive) void navigate({ to: '/local' })
          remove(channel.id)
        }}
      />
    </>
  )
}

function ChannelGroup({
  group,
  onAddChannel,
  children
}: {
  group: LocalGroup
  onAddChannel: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const rename = useLocalStore((state) => state.renameGroup)
  const remove = useLocalStore((state) => state.deleteGroup)
  return (
    <SidebarGroup
      name={group.name}
      addLabel="Add a page or board"
      deleteDescription="The group is removed, but its pages and boards are kept — they move to the top, ungrouped."
      onRename={(name) => rename(group.id, name)}
      onDelete={() => remove(group.id)}
      onAddChannel={onAddChannel}
    >
      {children}
    </SidebarGroup>
  )
}
