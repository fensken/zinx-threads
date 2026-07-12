import { useCallback, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { ChatsCircle, Gear, MagnifyingGlass, Tray, Users } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { cn } from '@renderer/lib/utils'
import { initialsOf } from '@renderer/lib/initials'
import { messagePreview } from '@renderer/lib/message-preview'
import { presenceForStatus, STATUS_LABEL, normalizeStatus } from '@renderer/lib/user-status'
import { useUiStore } from '@renderer/store/ui-store'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'

export interface PaletteItem {
  key: string
  group: string
  label: string
  sublabel?: string
  icon: React.ReactNode
  run: () => void
  /** Skip the client-side text filter — the item was already matched server-side
   *  (message search), so its label needn't literally contain the query. */
  skipFilter?: boolean
}

const GROUP_ORDER = ['Channels', 'Messages', 'Threads', 'People', 'Workspaces', 'Actions']

/** ⌘K palette — searches live Convex channels / messages / threads / people /
 *  workspaces.
 *
 *  Closed → nothing mounts. That matters: it holds several `useQuery` subscriptions,
 *  and there's no reason to carry them while the palette is shut. It also means
 *  `query`/`active` reset on close for free. */
export function CommandPalette({
  serverId,
  workspaceDocId
}: {
  serverId: string
  workspaceDocId: Id<'workspaces'>
}): React.JSX.Element | null {
  const open = useUiStore((state) => state.paletteOpen)
  if (!open) return null
  return <RealPalette serverId={serverId} workspaceId={workspaceDocId} />
}

/** The bits both paths need: navigation, dismissal, and the workspace-agnostic
 *  Actions group that closes the palette after running. */
function usePaletteChrome(): {
  close: () => void
  navigate: ReturnType<typeof useNavigate>
  openThread: (id: string) => void
  actions: PaletteItem[]
} {
  const setOpen = useUiStore((state) => state.setPaletteOpen)
  const openThread = useUiStore((state) => state.openThread)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)
  const setInboxOpen = useUiStore((state) => state.setInboxOpen)
  const toggleMemberList = useUiStore((state) => state.toggleMemberList)
  const navigate = useNavigate()
  const close = useCallback(() => setOpen(false), [setOpen])

  const actions: PaletteItem[] = [
    {
      key: 'a-settings',
      group: 'Actions',
      label: 'Open settings',
      icon: <Gear className="size-4" />,
      run: () => {
        setSettingsOpen(true)
        close()
      }
    },
    {
      key: 'a-inbox',
      group: 'Actions',
      label: 'Open inbox',
      icon: <Tray className="size-4" />,
      run: () => {
        setInboxOpen(true)
        close()
      }
    },
    {
      key: 'a-members',
      group: 'Actions',
      label: 'Toggle member list',
      icon: <Users className="size-4" />,
      run: () => {
        toggleMemberList()
        close()
      }
    }
  ]

  return { close, navigate, openThread, actions }
}

/** Convex-backed palette. All four queries are already live elsewhere (sidebar,
 *  members panel, threads flyout, workspace switcher), so Convex dedupes the
 *  subscriptions — this costs a lookup, not a round-trip. */
function RealPalette({
  serverId,
  workspaceId
}: {
  serverId: string
  workspaceId: Id<'workspaces'>
}): React.JSX.Element {
  const { close, navigate, openThread, actions } = usePaletteChrome()
  const setMemberListOpen = useUiStore((state) => state.setMemberListOpen)
  const [query, setQuery] = useState('')

  const channels = useQuery(api.channels.listBySlug, { slug: serverId })
  const threads = useQuery(api.threads.listByWorkspace, { workspaceId })
  const members = useQuery(api.members.listByWorkspace, { workspaceId })
  const workspaces = useQuery(api.workspaces.myWorkspaces)
  // Full-text search — only while there's a term (Convex `'skip'` otherwise).
  const term = query.trim()
  const messageHits = useQuery(
    api.messages.searchInWorkspace,
    term ? { workspaceId, term } : 'skip'
  )

  const loading =
    channels === undefined ||
    threads === undefined ||
    members === undefined ||
    workspaces === undefined

  const items: PaletteItem[] = []

  for (const channel of channels ?? []) {
    items.push({
      key: `ch-${channel._id}`,
      group: 'Channels',
      label: channel.name,
      sublabel: channel.topic,
      icon: <ChannelKindIcon kind={channel.kind} className="size-4" />,
      run: () => {
        navigate({
          to: '/w/$workspaceId/$channelSlug',
          params: { workspaceId: serverId, channelSlug: channel.name }
        })
        close()
      }
    })
  }

  for (const thread of threads ?? []) {
    items.push({
      key: `th-${thread._id}`,
      group: 'Threads',
      label: thread.name,
      sublabel: `#${thread.channelName} · ${plural(thread.replyCount, 'reply', 'replies')}`,
      icon: <ChatsCircle className="size-4" />,
      run: () => {
        navigate({
          to: '/w/$workspaceId/$channelSlug',
          params: { workspaceId: serverId, channelSlug: thread.channelName }
        })
        openThread(thread._id)
        close()
      }
    })
  }

  for (const { membership, user } of members ?? []) {
    const name = membership.displayName?.trim() || user.name
    const status = normalizeStatus(user.presence)
    items.push({
      key: `mb-${user._id}`,
      group: 'People',
      label: name,
      // The status they set, else the presence label — never the raw user id.
      sublabel: user.statusText?.trim() || STATUS_LABEL[status],
      icon: (
        <Avatar
          initials={initialsOf(name)}
          color={user.color ?? FALLBACK_AVATAR_COLOR}
          image={user.avatarUrl}
          className="size-5"
          presence={presenceForStatus(user.presence)}
          ringClassName="ring-2 ring-popover"
        />
      ),
      // There is no DM or profile route yet, so the honest action is to reveal
      // them where they *are* addressable: the members panel.
      run: () => {
        setMemberListOpen(true)
        close()
      }
    })
  }

  for (const { workspace, role } of workspaces ?? []) {
    if (workspace.slug === serverId) continue
    items.push({
      key: `ws-${workspace._id}`,
      group: 'Workspaces',
      label: workspace.name,
      sublabel: role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member',
      icon: (
        <WorkspaceGlyph
          image={workspace.imageUrl}
          icon={workspace.icon}
          name={workspace.name}
          className="size-5 rounded"
        />
      ),
      run: () => {
        navigate({ to: '/w/$workspaceId', params: { workspaceId: workspace.slug } })
        close()
      }
    })
  }

  for (const hit of messageHits ?? []) {
    const preview = messagePreview(hit.body)
    items.push({
      key: `msg-${hit._id}`,
      group: 'Messages',
      label: preview.isGif ? preview.text : preview.text || '(no text)',
      sublabel: `#${hit.channelName} · ${hit.authorName}`,
      skipFilter: true,
      icon: (
        <Avatar
          initials={initialsOf(hit.authorName)}
          color={hit.authorColor ?? FALLBACK_AVATAR_COLOR}
          image={hit.authorAvatarUrl}
          className="size-5 text-[9px]"
          ringClassName="ring-2 ring-popover"
        />
      ),
      run: () => {
        navigate({
          to: '/w/$workspaceId/$channelSlug',
          params: { workspaceId: serverId, channelSlug: hit.channelName }
        })
        close()
      }
    })
  }

  items.push(...actions)
  return (
    <PaletteDialog
      items={items}
      loading={loading}
      query={query}
      onQueryChange={setQuery}
      close={close}
    />
  )
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Presentational: search box, grouped results, keyboard nav. `query` is
 *  controlled so the parent can drive server-side search (message full-text).
 *  Exported so the offline shell reuses the exact same palette (see
 *  `local-command-palette.tsx`) — one modal, two data sources. */
export function PaletteDialog({
  items: all,
  loading,
  query,
  onQueryChange,
  close
}: {
  items: PaletteItem[]
  loading: boolean
  query: string
  onQueryChange: (value: string) => void
  close: () => void
}): React.JSX.Element {
  const [active, setActive] = useState(0)

  const q = query.trim().toLowerCase()
  const items = q
    ? all.filter(
        (i) =>
          i.skipFilter || i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q)
      )
    : all
  const activeIndex = Math.min(active, Math.max(0, items.length - 1))
  const groups = GROUP_ORDER.filter((g) => items.some((i) => i.group === g))

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(Math.min(items.length - 1, activeIndex + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(Math.max(0, activeIndex - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      items[activeIndex]?.run()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-center bg-black/50 px-4 pt-[14dvh] backdrop-blur-sm"
      onClick={close}
    >
      {/* A **fixed** height, not `h-fit`. Otherwise the card is spinner-sized
          while the queries land and then snaps to the results — and it resizes
          on every keystroke as the filter narrows. Every serious palette
          (Raycast, Linear, Slack's switcher) holds one height. `rem` so it still
          follows the UI-scale setting. */}
      <div
        className="flex h-[26rem] max-h-[70dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-4">
          <MagnifyingGlass className="size-5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search messages, or jump to a channel, person…"
            className="flex-1 bg-transparent py-3.5 text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:block">
            Esc
          </kbd>
        </div>

        <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto py-2">
          {loading ? (
            <LoadingBlock />
          ) : items.length === 0 ? (
            <p className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
              No results.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group} className="mb-1">
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {group}
                </div>
                {items
                  .filter((item) => item.group === group)
                  .map((item) => {
                    const index = items.indexOf(item)
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={item.run}
                        onMouseMove={() => setActive(index)}
                        className={cn(
                          'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                          index === activeIndex ? 'bg-accent text-foreground' : 'text-foreground/90'
                        )}
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                          {item.icon}
                        </span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.sublabel ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {item.sublabel}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
