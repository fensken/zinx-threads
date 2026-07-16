import { useState } from 'react'
import { CaretRight, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { Button } from '@renderer/components/ui/button'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { RenameField } from '@renderer/components/chat/rename-field'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { cn } from '@renderer/lib/utils'

/**
 * The presentational atoms of a channel sidebar row + group, shared by the online
 * (`real-channel-sidebar.tsx`, Convex-backed) and offline (`local/local-sidebar.tsx`,
 * disk-backed) sidebars so the styling is single-sourced and can't drift. Each sidebar
 * supplies its own data + routing (an online `<Link>` to `/w/…` vs an offline one to
 * `/local/…`, Convex mutations vs local-store actions); everything you *see* comes from here.
 *
 * This is the same presentational-adapter split that `PageEditor`/`BoardView` already use —
 * one look, two data sources.
 */

/** The base class for a row's interactive surface — the `<Link>`/`<button>` the row wraps.
 *  Kept identical to the quick-nav `QuickItem` metrics so nav rows and channel rows line up
 *  in one left-hand column. */
const SURFACE_BASE =
  'flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground'

/** Reserve right-hand room so the name truncates *before* it reaches the overlaid actions +
 *  badges. The two hover buttons always occupy their width (they only fade in), so this grows
 *  only with the count of ALWAYS-visible badges (mentions, thread count). */
function trailingPad(badges: number): string {
  if (badges >= 2) return 'pr-28'
  return badges === 1 ? 'pr-20' : 'pr-12'
}

/** A small icon button that appears on row hover (rename / delete). Uses the shadcn `Button`
 *  (never a hand-rolled one). `onPointerDown` stops propagation so a click doesn't start a
 *  drag on the DnD-sortable row underneath. */
export function RowActionButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={label}
      aria-label={label}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
      className="text-muted-foreground hover:bg-background/40 hover:text-sidebar-foreground"
    >
      {children}
    </Button>
  )
}

/**
 * The shell of a channel row: the hover group, the styled interactive surface, and the
 * right-anchored cluster (hover-only actions that fade in, then always-visible badges). The
 * adapter renders its own surface via `surface(className)` — a route-typed `<Link>` with its
 * own leading icon, name and inline glyphs — using the class this computes.
 */
export function SidebarRow({
  active,
  emphasized,
  nested,
  reserve = 0,
  surface,
  hoverActions,
  badges
}: {
  /** The open channel — accent background + medium weight. */
  active?: boolean
  /** Unread (but not active) — medium weight, no background. Colour stays reserved for the
   *  mention pill, so unread reads as weight, never hue. */
  emphasized?: boolean
  /** A child of a group — indented one level. */
  nested?: boolean
  /** How many ALWAYS-visible badges the row shows, so the name reserves room to truncate. */
  reserve?: number
  surface: (className: string) => React.ReactNode
  /** Fades in on hover (rename / delete). */
  hoverActions?: React.ReactNode
  /** Always visible, at the very end (mentions, thread count). */
  badges?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="group/ch relative flex items-center">
      {surface(
        cn(
          SURFACE_BASE,
          nested ? 'pl-5' : 'pl-2',
          trailingPad(reserve),
          active
            ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
            : emphasized
              ? 'font-medium text-sidebar-foreground'
              : 'text-sidebar-foreground'
        )
      )}

      {/* One right-anchored cluster: hover-only actions fade in to the LEFT of the
          always-visible badges, so nothing the reader can normally see ever moves. */}
      <div className="pointer-events-none absolute right-1 flex items-center gap-1">
        {hoverActions ? (
          <div className="pointer-events-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/ch:opacity-100">
            {hoverActions}
          </div>
        ) : null}
        {badges}
      </div>
    </div>
  )
}

/**
 * A collapsible sidebar group — the header (caret + name + hover rename/delete/add),
 * the right-click context menu, and the delete confirm. Owns its own collapse / rename /
 * confirm UI state; the adapter supplies only the data handlers + the two bits of copy that
 * differ between online ("Create channel" / "channels") and offline ("Add a page or board" /
 * "pages and boards"). Same look in both by construction.
 */
export function SidebarGroup({
  name,
  addLabel,
  deleteDescription,
  onRename,
  onDelete,
  onAddChannel,
  children
}: {
  name: string
  /** The "add" action's label — "Create channel" online, "Add a page or board" offline. */
  addLabel: string
  /** What the delete-confirm warns is kept (channels vs pages/boards). */
  deleteDescription: string
  onRename: (name: string) => void
  onDelete: () => void | Promise<void>
  onAddChannel: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="mt-2">
      {editing ? (
        <RenameField
          initial={name}
          className="bg-sidebar-accent"
          onCancel={() => setEditing(false)}
          onSubmit={(value) => {
            const clean = value.trim()
            if (clean && clean !== name) onRename(clean)
            setEditing(false)
          }}
        />
      ) : (
        <ContextMenu>
          <ContextMenuTrigger>
            <div className="group/grp flex items-center gap-0.5 px-1">
              <button
                type="button"
                onClick={() => setCollapsed((current) => !current)}
                className="flex min-w-0 flex-1 items-center gap-1 rounded py-1 text-[13px] font-medium text-sidebar-foreground transition-colors hover:text-sidebar-foreground"
              >
                <CaretRight
                  className={cn(
                    'size-3.5 shrink-0 transition-transform',
                    !collapsed && 'rotate-90'
                  )}
                />
                <span className="truncate">{name}</span>
              </button>
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/grp:opacity-100">
                <RowActionButton label="Rename group" onClick={() => setEditing(true)}>
                  <PencilSimple className="size-3.5" />
                </RowActionButton>
                <RowActionButton label="Delete group" onClick={() => setConfirmDelete(true)}>
                  <Trash className="size-3.5" />
                </RowActionButton>
                <RowActionButton label={addLabel} onClick={onAddChannel}>
                  <Plus className="size-3.5" weight="bold" />
                </RowActionButton>
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            <ContextMenuItem onClick={onAddChannel}>
              <Plus className="text-muted-foreground" weight="bold" />
              {addLabel}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setEditing(true)}>
              <PencilSimple className="text-muted-foreground" />
              Rename group
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setCollapsed((current) => !current)}>
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
        title={`Delete the "${name}" group?`}
        description={deleteDescription}
        confirmLabel="Delete group"
        onConfirm={onDelete}
      />
    </div>
  )
}
