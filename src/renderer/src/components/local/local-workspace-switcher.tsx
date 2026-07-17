import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CaretUpDown, Gear, MagnifyingGlass, Plus, SignIn } from '@phosphor-icons/react'
import { useLocalStore, useCurrentLocalWorkspace } from '@renderer/store/local-store'
import { useLocalUiStore } from '@renderer/store/local-ui-store'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'
import { LocalCreateWorkspaceDialog } from '@renderer/components/local/local-create-workspace-dialog'
import { cn } from '@renderer/lib/utils'

/** Past this many workspaces the switcher shows a name filter (mirrors the online
 *  `WorkspaceSwitcher`'s `SEARCH_THRESHOLD`). */
const SEARCH_THRESHOLD = 4

/** Local workspace switcher — the counterpart of `WorkspaceSwitcher`. Same trigger +
 *  dropdown layout, backed by the local store: switch between local workspaces, create
 *  one (same dialog as online), search once there are a few, open workspace settings
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
  const [query, setQuery] = useState('')

  const close = (): void => {
    setOpen(false)
    setQuery('')
  }

  const term = query.trim().toLowerCase()
  const filtered = term
    ? workspaces.filter((workspace) => workspace.name.toLowerCase().includes(term))
    : workspaces

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
          name={current?.name ?? 'Local'}
          className="size-8 shrink-0 overflow-hidden rounded-lg text-sm text-foreground"
          iconClassName="size-5"
        />
        <span className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate font-semibold">{current?.name ?? 'Local'}</span>
          <span className="truncate text-xs text-muted-foreground">Local · this device</span>
        </span>
        <CaretUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={close} />
          <div className="absolute top-full left-0 z-30 mt-1 flex max-h-[80dvh] w-full flex-col rounded-xl border bg-popover p-1.5 shadow-2xl">
            <div className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Local workspaces
            </div>

            {workspaces.length > SEARCH_THRESHOLD ? (
              <div className="mb-1 flex items-center gap-2 rounded-lg border bg-background px-2">
                <MagnifyingGlass className="size-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search workspaces…"
                  className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            ) : null}

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              {filtered.map((workspace) => (
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
                    className="size-7 shrink-0 overflow-hidden rounded-md text-[11px] text-foreground"
                    iconClassName="size-4"
                  />
                  <span className="min-w-0 flex-1 truncate text-left">{workspace.name}</span>
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  {workspaces.length === 0 ? 'No local workspaces yet.' : 'No workspaces match.'}
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
