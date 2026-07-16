import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CaretUpDown, Gear, Plus, SignIn } from '@phosphor-icons/react'
import { useLocalStore, useCurrentLocalWorkspace } from '@renderer/store/local-store'
import { useLocalUiStore } from '@renderer/store/local-ui-store'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'
import { LocalCreateWorkspaceDialog } from '@renderer/components/local/local-create-workspace-dialog'
import { cn } from '@renderer/lib/utils'

/** Offline workspace switcher — the local counterpart of `WorkspaceSwitcher`. Same
 *  trigger + dropdown layout, backed by the local store: switch between offline
 *  workspaces, create one (same dialog as online), open workspace settings
 *  (rename / icon / delete), and jump back to the online app. */
export function LocalWorkspaceSwitcher(): React.JSX.Element {
  const workspaces = useLocalStore((state) => state.workspaces)
  const currentWorkspaceId = useLocalStore((state) => state.currentWorkspaceId)
  const current = useCurrentLocalWorkspace()
  const setCurrentWorkspace = useLocalStore((state) => state.setCurrentWorkspace)
  const openSettings = useLocalUiStore((state) => state.openSettings)
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const close = (): void => setOpen(false)

  const go = (id: string): void => {
    setCurrentWorkspace(id)
    close()
    void navigate({ to: '/local' })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent"
      >
        <WorkspaceGlyph
          image={current?.image}
          icon={current?.icon}
          name={current?.name ?? 'Offline'}
          className="size-8 shrink-0 overflow-hidden rounded-lg bg-warning/15 text-sm text-warning"
          iconClassName="size-5"
        />
        <span className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate font-semibold">{current?.name ?? 'Offline'}</span>
          <span className="truncate text-xs text-muted-foreground">Offline · this device</span>
        </span>
        <CaretUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={close} />
          <div className="absolute top-full left-0 z-30 mt-1 flex max-h-[80dvh] w-full flex-col rounded-xl border bg-popover p-1.5 shadow-2xl">
            <div className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Offline workspaces
            </div>

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => go(workspace.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                    workspace.id === currentWorkspaceId &&
                      'rounded-l-none border-l-2 border-primary bg-accent'
                  )}
                >
                  <WorkspaceGlyph
                    image={workspace.image}
                    icon={workspace.icon}
                    name={workspace.name}
                    className="size-7 shrink-0 overflow-hidden rounded-md bg-warning/15 text-[11px] text-warning"
                    iconClassName="size-4"
                  />
                  <span className="min-w-0 flex-1 truncate text-left">{workspace.name}</span>
                </button>
              ))}
              {workspaces.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  No offline workspaces yet.
                </p>
              ) : null}
            </div>

            <div className="my-1 h-px bg-border" />
            {current ? (
              <SwitcherItem
                icon={<Gear className="size-4" />}
                onClick={() => {
                  close()
                  openSettings('workspace')
                }}
              >
                Workspace settings
              </SwitcherItem>
            ) : null}
            <SwitcherItem
              icon={<Plus className="size-4" weight="bold" />}
              onClick={() => {
                close()
                setCreateOpen(true)
              }}
            >
              Create workspace
            </SwitcherItem>
            <SwitcherItem
              icon={<SignIn className="size-4" />}
              onClick={() => {
                close()
                void navigate({ to: '/' })
              }}
            >
              Sign in to the online app
            </SwitcherItem>
          </div>
        </>
      ) : null}

      <LocalCreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function SwitcherItem({
  icon,
  onClick,
  children
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <span className="flex size-7 items-center justify-center">{icon}</span>
      {children}
    </button>
  )
}
