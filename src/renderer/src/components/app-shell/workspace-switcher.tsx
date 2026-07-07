import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CaretUpDown, Gear, Plus } from '@phosphor-icons/react'
import { getServer, servers } from '@renderer/data/workspaces'
import { cn } from '@renderer/lib/utils'

export function WorkspaceSwitcher({ serverId }: { serverId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const current = getServer(serverId)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent"
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: current?.color }}
        >
          {current?.initials}
        </span>
        <span className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate font-semibold">{current?.name}</span>
          <span className="truncate text-xs text-muted-foreground">Workspace</span>
        </span>
        <CaretUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-1 top-full z-30 mt-1 rounded-xl border bg-popover p-1.5 shadow-2xl">
            <div className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Workspaces
            </div>
            {servers.map((server) => (
              <button
                key={server.id}
                type="button"
                onClick={() => {
                  navigate({ to: '/w/$workspaceId', params: { workspaceId: server.id } })
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                  server.id === serverId && 'rounded-l-none border-l-2 border-primary bg-accent'
                )}
              >
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                  style={{ backgroundColor: server.color }}
                >
                  {server.initials}
                </span>
                <span className="min-w-0 flex-1 truncate text-left">{server.name}</span>
                {server.mentions ? (
                  <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                    {server.mentions}
                  </span>
                ) : null}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <span className="flex size-7 items-center justify-center">
                <Plus className="size-4" weight="bold" />
              </span>
              Add a workspace
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <span className="flex size-7 items-center justify-center">
                <Gear className="size-4" />
              </span>
              Workspace settings
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
