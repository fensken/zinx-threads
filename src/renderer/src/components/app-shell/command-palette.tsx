import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChatsCircle, Gear, Hash, Lock, MagnifyingGlass, Tray, Users } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import { getChannels, getMembers, getThreadsForServer, servers } from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'
import { Avatar } from './avatar'

interface PaletteItem {
  key: string
  group: string
  label: string
  sublabel?: string
  icon: React.ReactNode
  run: () => void
}

const GROUP_ORDER = ['Channels', 'Threads', 'People', 'Servers', 'Actions']

export function CommandPalette({ serverId }: { serverId: string }): React.JSX.Element | null {
  const open = useUiStore((state) => state.paletteOpen)
  const setOpen = useUiStore((state) => state.setPaletteOpen)
  const openThread = useUiStore((state) => state.openThread)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)
  const setInboxOpen = useUiStore((state) => state.setInboxOpen)
  const toggleMemberList = useUiStore((state) => state.toggleMemberList)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  if (!open) return null

  const close = (): void => {
    setOpen(false)
    setQuery('')
    setActive(0)
  }

  const all: PaletteItem[] = []

  for (const channel of getChannels(serverId).filter((c) => c.kind !== 'voice')) {
    all.push({
      key: `ch-${channel.id}`,
      group: 'Channels',
      label: channel.name,
      sublabel: channel.shared ? 'Shared channel' : undefined,
      icon: channel.private ? <Lock className="size-4" /> : <Hash className="size-4" />,
      run: () => {
        navigate({
          to: '/w/$workspaceId/c/$channelId',
          params: { workspaceId: serverId, channelId: channel.id }
        })
        close()
      }
    })
  }

  for (const thread of getThreadsForServer(serverId)) {
    all.push({
      key: `th-${thread.id}`,
      group: 'Threads',
      label: thread.name,
      sublabel: `${thread.replies.length} replies`,
      icon: <ChatsCircle className="size-4" />,
      run: () => {
        navigate({
          to: '/w/$workspaceId/c/$channelId',
          params: { workspaceId: serverId, channelId: thread.channelId }
        })
        openThread(thread.id)
        close()
      }
    })
  }

  for (const member of getMembers(serverId)) {
    all.push({
      key: `mb-${member.id}`,
      group: 'People',
      label: member.name,
      sublabel: member.status,
      icon: <Avatar initials={member.initials} color={member.color} className="size-5" />,
      run: close
    })
  }

  for (const server of servers) {
    all.push({
      key: `sv-${server.id}`,
      group: 'Servers',
      label: server.name,
      icon: (
        <span
          className="flex size-5 items-center justify-center rounded-md text-[9px] font-bold text-white"
          style={{ backgroundColor: server.color }}
        >
          {server.initials}
        </span>
      ),
      run: () => {
        navigate({ to: '/w/$workspaceId', params: { workspaceId: server.id } })
        close()
      }
    })
  }

  all.push(
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
  )

  const q = query.trim().toLowerCase()
  const items = q
    ? all.filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q))
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
      <div
        className="flex h-fit max-h-[70dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-4">
          <MagnifyingGlass className="size-5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a channel, thread, person…"
            className="flex-1 bg-transparent py-3.5 text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:block">
            Esc
          </kbd>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No results.</p>
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
