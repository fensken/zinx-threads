import { useNavigate, useParams } from '@tanstack/react-router'
import { Gear, Plus } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import { servers } from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'

/** Optional Discord-style left rail of workspaces (toggled in settings). Each
 *  avatar morphs squircle → rounded-square on hover/active, with a left pill
 *  indicator and mention badge — modeled on the `_zinx` community switcher. */
export function ServerRail(): React.JSX.Element {
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { workspaceId?: string }
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-border bg-sidebar py-3">
      {servers.map((server) => {
        const active = server.id === params.workspaceId
        return (
          <button
            key={server.id}
            type="button"
            title={server.name}
            aria-label={server.name}
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate({ to: '/w/$workspaceId', params: { workspaceId: server.id } })}
            className="group relative flex items-center justify-center"
          >
            {/* Left active/hover pill */}
            <span
              className={cn(
                'absolute -left-3 w-1 rounded-r-full bg-foreground transition-all duration-150',
                active ? 'h-9' : 'h-0 group-hover:h-5'
              )}
            />
            <span
              className={cn(
                'flex size-11 items-center justify-center text-sm font-bold text-white transition-all duration-150',
                active ? 'rounded-2xl' : 'rounded-[22px] group-hover:rounded-2xl'
              )}
              style={{ backgroundColor: server.color }}
            >
              {server.initials}
            </span>
            {server.mentions ? (
              <span className="absolute -right-0.5 -bottom-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground ring-2 ring-sidebar">
                {server.mentions}
              </span>
            ) : null}
          </button>
        )
      })}

      <div className="my-1 h-px w-8 shrink-0 bg-border" />

      <button
        type="button"
        title="Add a workspace"
        aria-label="Add a workspace"
        className="flex size-11 shrink-0 items-center justify-center rounded-[22px] bg-sidebar-accent text-muted-foreground transition-all duration-150 hover:rounded-2xl hover:bg-primary hover:text-primary-foreground"
      >
        <Plus className="size-5" weight="bold" />
      </button>

      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => setSettingsOpen(true)}
        className="mt-auto flex size-11 shrink-0 items-center justify-center rounded-[22px] text-muted-foreground transition-all duration-150 hover:rounded-2xl hover:bg-sidebar-accent hover:text-foreground"
      >
        <Gear className="size-5" />
      </button>
    </nav>
  )
}
