import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import {
  CaretUpDown,
  Checks,
  Compass,
  CrownSimple,
  Gear,
  MagnifyingGlass,
  Plus,
  UserPlus
} from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Doc } from '@convex/_generated/dataModel'
import { useUiStore } from '@renderer/store/ui-store'
import { cn } from '@renderer/lib/utils'
import { CreateWorkspaceDialog } from '@renderer/components/workspace/create-workspace-dialog'
import { InviteDialog } from '@renderer/components/workspace/invite-dialog'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'
import type { Role } from '@renderer/components/settings/workspace-settings'

// Show the search box once the list is long enough to warrant it.
const SEARCH_THRESHOLD = 4

/** Right-aligned role marker: a crown for owners, a muted label otherwise — so a
 *  person can tell at a glance which workspaces they own. */
function RoleBadge({ role }: { role: Role }): React.JSX.Element {
  if (role === 'owner') {
    return (
      <span title="You own this workspace" className="ml-auto flex shrink-0 items-center">
        <CrownSimple weight="fill" className="size-3.5 text-primary" />
      </span>
    )
  }
  return (
    <span className="ml-auto shrink-0 text-[10px] font-medium tracking-wide text-muted-foreground capitalize">
      {role}
    </span>
  )
}

/** One selectable workspace row (with its role marker). */
function WorkspaceRow({
  workspace,
  role,
  active,
  onClick
}: {
  workspace: Doc<'workspaces'>
  role: Role
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent',
        active && 'rounded-l-none border-l-2 border-primary bg-accent'
      )}
    >
      <WorkspaceGlyph
        image={workspace.imageUrl}
        icon={workspace.icon}
        name={workspace.name}
        className="size-7 shrink-0 overflow-hidden rounded-md text-[11px] text-foreground"
        iconClassName="size-4"
      />
      <span className="min-w-0 flex-1 truncate text-left">{workspace.name}</span>
      <RoleBadge role={role} />
    </button>
  )
}

export function WorkspaceSwitcher({ serverId }: { serverId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const navigate = useNavigate()
  const openSettings = useUiStore((s) => s.openSettings)
  const workspacesData = useQuery(api.workspaces.myWorkspaces)
  const workspaces = useMemo(() => workspacesData ?? [], [workspacesData])
  const currentEntry = workspaces.find((w) => w.workspace.slug === serverId)
  const current = currentEntry?.workspace

  // Only subscribe while the dropdown is open — it's the one place "Mark all as
  // read" lives, and this component is always mounted. The sidebar's own unread
  // subscription is deduped by the query cache, so this is a shared read.
  const markAllRead = useMutation(api.unread.markAllRead)
  const unread = useQuery(
    api.unread.listByWorkspace,
    open && current ? { workspaceId: current._id } : 'skip'
  )
  const hasUnread = (unread?.length ?? 0) > 0

  const query = search.trim().toLowerCase()
  const isSearching = query.length > 0
  const filtered = useMemo(
    () =>
      isSearching
        ? workspaces.filter(
            (w) =>
              w.workspace.name.toLowerCase().includes(query) ||
              w.workspace.slug.toLowerCase().includes(query)
          )
        : workspaces,
    [workspaces, isSearching, query]
  )

  const close = (): void => {
    setOpen(false)
    setSearch('')
  }
  const go = (slug: string): void => {
    navigate({ to: '/w/$workspaceId', params: { workspaceId: slug } })
    close()
  }

  const headerSubtitle = currentEntry
    ? currentEntry.role === 'owner'
      ? 'Owner'
      : currentEntry.role === 'admin'
        ? 'Admin'
        : 'Member'
    : 'Workspace'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent"
      >
        <WorkspaceGlyph
          image={current?.imageUrl}
          icon={current?.icon}
          name={current?.name ?? 'Select workspace'}
          className="size-8 shrink-0 overflow-hidden rounded-lg text-sm text-foreground"
          iconClassName="size-5"
        />
        <span className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate font-semibold">{current?.name ?? 'Select workspace'}</span>
          <span className="truncate text-xs text-muted-foreground">{headerSubtitle}</span>
        </span>
        <CaretUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-20" onClick={close} />
          <div className="absolute top-full left-0 z-30 mt-1 flex max-h-[80dvh] w-full flex-col rounded-xl border bg-popover p-1.5 shadow-2xl">
            <div className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Workspaces
            </div>

            {workspaces.length > SEARCH_THRESHOLD ? (
              <div className="px-1 pb-1.5">
                <div className="relative">
                  <MagnifyingGlass className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search workspaces…"
                    className="h-8 w-full rounded-md border border-input bg-transparent pr-2 pl-8 text-xs outline-none focus:border-ring dark:bg-input/30"
                  />
                </div>
              </div>
            ) : null}

            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              {filtered.map(({ workspace, role }) => (
                <WorkspaceRow
                  key={workspace._id}
                  workspace={workspace}
                  role={role}
                  active={workspace.slug === serverId}
                  onClick={() => go(workspace.slug)}
                />
              ))}

              {isSearching && filtered.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No workspaces found
                </p>
              ) : null}
            </div>

            <div className="my-1 h-px bg-border" />
            {current && hasUnread ? (
              <button
                type="button"
                onClick={() => {
                  void markAllRead({ workspaceId: current._id })
                  close()
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <span className="flex size-7 items-center justify-center">
                  <Checks className="size-4" />
                </span>
                Mark all as read
              </button>
            ) : null}
            {current ? (
              <button
                type="button"
                onClick={() => {
                  close()
                  setInviteOpen(true)
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <span className="flex size-7 items-center justify-center">
                  <UserPlus className="size-4" />
                </span>
                Invite people
              </button>
            ) : null}
            {current ? (
              <button
                type="button"
                onClick={() => {
                  openSettings('ws-general')
                  close()
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <span className="flex size-7 items-center justify-center">
                  <Gear className="size-4" />
                </span>
                Workspace settings
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                close()
                setCreateOpen(true)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <span className="flex size-7 items-center justify-center">
                <Plus className="size-4" weight="bold" />
              </span>
              Create workspace
            </button>
            <button
              type="button"
              onClick={() => {
                navigate({ to: '/workspaces' })
                close()
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <span className="flex size-7 items-center justify-center">
                <Compass className="size-4" />
              </span>
              Find or join a workspace
            </button>
          </div>
        </>
      ) : null}

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      {current ? (
        <InviteDialog
          workspaceId={current._id}
          workspaceName={current.name}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
        />
      ) : null}
    </div>
  )
}
