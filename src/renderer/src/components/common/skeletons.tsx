import { Skeleton } from '@renderer/components/ui/skeleton'
import { useUiStore } from '@renderer/store/ui-store'
import { useMediaQuery } from '@renderer/lib/use-media-query'
import { cn } from '@renderer/lib/utils'

/**
 * App-wide loading skeletons. The rule (see `no-layout-shift` in CLAUDE.md): a
 * skeleton must occupy the SAME box its real content will, and mirror its layout
 * closely enough that the swap to real data doesn't move anything. So each skeleton
 * here copies the paddings, sizes and row rhythm of the component it stands in for.
 *
 * They fill a `min-h-0 flex-1` region (message list, board, page, members) or a
 * reserved height (dialogs), exactly like `LoadingBlock` — a skeleton with no height
 * of its own would collapse and then snap, which is the shift we're avoiding.
 *
 * Deterministic widths (fixed arrays, not `Math.random`) keep it stable across
 * re-renders and give a natural, staggered look.
 */

/** Cycle a fixed list so repeated rows look varied but render identically each time. */
function pick<T>(list: T[], index: number): T {
  return list[index % list.length]
}

// ── Message list ──────────────────────────────────────────────────────────────

const BODY_WIDTHS = ['72%', '48%', '90%', '61%', '38%', '83%', '55%']
/** true = a new author group (avatar + name header); false = a grouped follow-up row. */
const MESSAGE_SHAPE = [true, false, false, true, false, true, false, false, true, false]

function MessageRowSkeleton({ index }: { index: number }): React.JSX.Element {
  const newGroup = pick(MESSAGE_SHAPE, index)
  const lines = index % 3 === 0 ? 2 : 1
  return (
    <div className={cn('mx-2 flex items-start gap-4 px-2 py-1', newGroup && 'mt-3')}>
      <div className="flex w-10 shrink-0 justify-end">
        {newGroup ? <Skeleton className="size-10 rounded-full" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        {newGroup ? (
          <div className="mb-1.5 flex items-center gap-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-10" />
          </div>
        ) : null}
        <div className="space-y-1.5">
          {Array.from({ length: lines }).map((_, line) => (
            <Skeleton
              key={line}
              className="h-3.5"
              style={{ width: pick(BODY_WIDTHS, index + line) }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** The chat message list. Bottom-anchored (chat sticks to the newest), matching the
 *  real list's `py-3`. Fills the `min-h-0 flex-1` content area. */
export function MessageListSkeleton({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      aria-hidden
      className={cn('flex min-h-0 flex-1 flex-col justify-end overflow-hidden py-3', className)}
    >
      {Array.from({ length: 9 }).map((_, index) => (
        <MessageRowSkeleton key={index} index={index} />
      ))}
    </div>
  )
}

// ── Member list ───────────────────────────────────────────────────────────────

/** Grouped member rows (avatar `size-8` + name/subtitle), matching `RealMemberList`'s
 *  body (groups `mb-5 px-2`, rows `px-2 py-1`). Drops into the panel's own scroll
 *  container (which supplies the `py-4`), and the panel owns the header. */
export function MemberListSkeleton(): React.JSX.Element {
  const groups = [
    { rows: 1, w: 'w-16' },
    { rows: 3, w: 'w-20' },
    { rows: 5, w: 'w-24' }
  ]
  return (
    <div aria-hidden>
      {groups.map((group, g) => (
        <div key={g} className="mb-5 px-2">
          <Skeleton className={cn('mx-2 mb-2 h-2.5', group.w)} />
          <div className="space-y-1">
            {Array.from({ length: group.rows }).map((_, r) => (
              <div key={r} className="flex items-center gap-2 px-2 py-1">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3" style={{ width: pick(['55%', '40%', '68%'], r) }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Channel sidebar (channel list region) ─────────────────────────────────────

function ChannelRowSkeleton({ w }: { w: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
      <Skeleton className="size-4 shrink-0 rounded" />
      <Skeleton className={cn('h-3', w)} />
    </div>
  )
}

/** The channel-list portion of the sidebar (the switcher + quick-nav render live
 *  immediately). Two collapsible group headers + their channel rows. */
export function ChannelListSkeleton(): React.JSX.Element {
  const groups = [
    ['w-24', 'w-16', 'w-28'],
    ['w-20', 'w-24', 'w-16', 'w-24']
  ]
  return (
    <div aria-hidden className="space-y-4 px-2 py-2">
      {/* ungrouped rows on top */}
      <div className="space-y-0.5">
        <ChannelRowSkeleton w="w-20" />
        <ChannelRowSkeleton w="w-28" />
      </div>
      {groups.map((rows, g) => (
        <div key={g} className="space-y-0.5">
          <Skeleton className="mx-1 mb-1 h-2.5 w-20" />
          {rows.map((w, r) => (
            <ChannelRowSkeleton key={r} w={w} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Kanban board ──────────────────────────────────────────────────────────────

function TaskCardSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex gap-1.5">
        <Skeleton className="h-4 w-12 rounded-full" />
        <Skeleton className="h-4 w-10 rounded-full" />
      </div>
      <Skeleton className="h-3.5 w-[85%]" />
      <Skeleton className="h-3.5 w-[55%]" />
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="size-6 rounded-full" />
      </div>
    </div>
  )
}

/** A kanban board: a few columns each with a header + cards. Fills the board area. */
export function BoardSkeleton(): React.JSX.Element {
  const columns = [3, 2, 4, 1]
  return (
    <div aria-hidden className="flex min-h-0 flex-1 gap-3 overflow-hidden p-4">
      {columns.map((cards, c) => (
        <div key={c} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/40 p-2">
          <div className="flex items-center justify-between px-1 py-1">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="size-5 rounded" />
          </div>
          {Array.from({ length: cards }).map((_, i) => (
            <TaskCardSkeleton key={i} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Page (Notion-style document) ──────────────────────────────────────────────

/** A page channel — mirrors the **default** page, which has NO cover and NO icon
 *  (those are opt-in; a fresh page is just a title + body). So the skeleton is a
 *  title + a few prose lines, centred `max-w-3xl` with the editor's own `54px` inline
 *  padding (`.zinx-page-head`/`.bn-editor`) and `pt-12`, so the title lands exactly
 *  where the real one does — a cover/icon skeleton would draw a big band + tile that
 *  aren't there and then vanish. The `h-7` row reserves the (desktop-invisible)
 *  "Add icon / Add cover" affordance strip the real head keeps above the title. */
export function PageSkeleton(): React.JSX.Element {
  return (
    <div aria-hidden className="min-h-0 flex-1 overflow-hidden">
      <div className="mx-auto max-w-3xl px-[54px] pt-12">
        <div className="mb-1 h-7" />
        {/* Title (`text-4xl`), then the head's `mb-4` gap before the first block. */}
        <Skeleton className="mb-4 h-10 w-1/2" />
        <div className="space-y-3">
          {['64%', '82%', '48%'].map((w, i) => (
            <Skeleton key={i} className="h-4" style={{ width: w }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Inbox / notification rows ─────────────────────────────────────────────────

/** Inbox rows (avatar + two text lines), used by the full inbox page and the header
 *  peek. `rows` lets the peek show fewer. */
export function InboxListSkeleton({
  rows = 6,
  className
}: {
  rows?: number
  className?: string
}): React.JSX.Element {
  return (
    <div aria-hidden className={cn('space-y-1', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2.5">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 py-0.5">
            <Skeleton className="h-3" style={{ width: pick(['60%', '45%', '70%'], i) }} />
            <Skeleton className="h-3" style={{ width: pick(['85%', '92%', '75%'], i) }} />
          </div>
          <Skeleton className="h-2.5 w-10 shrink-0" />
        </div>
      ))}
    </div>
  )
}

// ── Calendar (month grid) ─────────────────────────────────────────────────────

/** A 6-row month grid of day cells (the calendar's fixed height never changes, so
 *  the grid can't shift). */
export function CalendarSkeleton(): React.JSX.Element {
  return (
    <div
      aria-hidden
      className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-xl border bg-border"
    >
      {Array.from({ length: 42 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5 bg-card p-1.5">
          <Skeleton className="size-5 rounded-full" />
          {i % 4 === 0 ? <Skeleton className="h-3.5 w-[80%] rounded" /> : null}
          {i % 7 === 3 ? <Skeleton className="h-3.5 w-[60%] rounded" /> : null}
        </div>
      ))}
    </div>
  )
}

// ── Generic list (dialogs, DM list, search) ───────────────────────────────────

/** A simple avatar + line row list — for pickers, DM lists and search results. */
export function RowListSkeleton({
  rows = 5,
  className
}: {
  rows?: number
  className?: string
}): React.JSX.Element {
  return (
    <div aria-hidden className={cn('space-y-1', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <Skeleton className="h-3" style={{ width: pick(['40%', '55%', '48%', '62%'], i) }} />
        </div>
      ))}
    </div>
  )
}

// ── Content area + full app shell ─────────────────────────────────────────────

/** The content column: a channel-style header bar + message list + a composer bar.
 *  Fills the outlet while a channel/landing resolves, so the header and composer
 *  don't pop in after the messages. */
export function ChannelViewSkeleton(): React.JSX.Element {
  return (
    <div aria-hidden className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <Skeleton className="size-5 rounded" />
        <Skeleton className="h-4 w-40" />
        <div className="ml-auto flex items-center gap-1.5">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
        </div>
      </header>
      <MessageListSkeleton />
      <div className="shrink-0 px-4 pb-2">
        <Skeleton className="h-13 w-full rounded-lg" />
      </div>
    </div>
  )
}

/** The whole app frame — sidebar + content (+ members panel) — shown while a workspace
 *  resolves, so the shell appears structured instantly instead of flashing a lone spinner
 *  then the three-region layout.
 *
 *  **It reads the SAME persisted layout prefs the real shell does** (`ui-store`
 *  `sidebarWidth`/`rightWidth`, `sidebarCollapsed`/`memberListOpen`) and the SAME `md`/`lg`
 *  breakpoints (`w.$workspaceId.tsx` + the channel page), so when the real shell mounts,
 *  the columns are already at the user's exact widths — no reflow. Mirrors the real
 *  layout's collapse rules too: no sidebar below `md` (it's a drawer, hidden by default)
 *  or when collapsed; no members panel below `lg` or when closed. */
export function WorkspaceShellSkeleton(): React.JSX.Element {
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const rightWidth = useUiStore((state) => state.rightWidth)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const memberListOpen = useUiStore((state) => state.memberListOpen)
  const isMdUp = useMediaQuery('(min-width: 768px)')
  const isLgUp = useMediaQuery('(min-width: 1024px)')
  const showSidebar = isMdUp && !sidebarCollapsed
  const showMembers = isLgUp && memberListOpen

  return (
    <div aria-hidden className="relative flex h-full overflow-hidden bg-card">
      {showSidebar ? (
        <>
          <div
            className="flex shrink-0 flex-col border-r border-border bg-sidebar"
            style={{ width: sidebarWidth }}
          >
            {/* switcher header */}
            <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
              <Skeleton className="size-8 rounded-lg" />
              <Skeleton className="h-4 w-28" />
            </div>
            {/* quick-nav (Search / Inbox / Events) */}
            <div className="space-y-1 px-2 py-2">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChannelListSkeleton />
            </div>
            {/* user bar */}
            <div className="flex h-13 shrink-0 items-center gap-2 border-t px-2">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-16" />
              </div>
            </div>
          </div>
          {/* Matches the `ResizeHandle`'s footprint so the content starts at the same x. */}
          <div className="-mx-0.5 w-1.5 shrink-0" />
        </>
      ) : null}

      <ChannelViewSkeleton />

      {showMembers ? (
        <div
          className="flex shrink-0 flex-col border-l border-border bg-card"
          style={{ width: rightWidth }}
        >
          <header className="flex h-14 shrink-0 items-center border-b px-3 shadow-sm">
            <Skeleton className="h-4 w-20" />
          </header>
          <div className="min-h-0 flex-1 overflow-hidden py-4">
            <MemberListSkeleton />
          </div>
        </div>
      ) : null}
    </div>
  )
}
