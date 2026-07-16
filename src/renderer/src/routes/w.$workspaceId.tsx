import { useEffect, useRef } from 'react'
import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { RealChannelSidebar } from '@renderer/components/chat/real-channel-sidebar'
import { ResizeHandle } from '@renderer/components/layout/resize-handle'
import { SettingsDialog } from '@renderer/components/settings/settings-dialog'
import { CommandPalette } from '@renderer/components/layout/command-palette'
import { WorkspaceDirectoryProvider } from '@renderer/components/chat/workspace-directory'
import { WorkspaceRightPanel } from '@renderer/components/chat/workspace-right-panel'
import { VoiceCallProvider } from '@renderer/components/voice/voice-call-provider'
import { EventReminderBanner } from '@renderer/components/events/event-reminder-banner'
import { WorkspaceShellSkeleton } from '@renderer/components/common/skeletons'
import { useUiStore } from '@renderer/store/ui-store'
import { useMediaQuery } from '@renderer/lib/use-media-query'
import { cn } from '@renderer/lib/utils'

export const Route = createFileRoute('/w/$workspaceId')({
  component: ServerLayout
})

/** Resolve the workspace slug via Convex; not-a-member / unknown → onboarding. */
function ServerLayout(): React.JSX.Element {
  const { workspaceId } = Route.useParams()
  const workspace = useQuery(api.workspaces.getBySlug, { slug: workspaceId })

  if (workspace === undefined) return <WorkspaceShellSkeleton />
  if (workspace === null) return <Navigate to="/workspaces" replace />
  return <Shell workspaceId={workspaceId} workspaceDocId={workspace.workspace._id} />
}

/** The workspace shell — sidebar + outlet + right panel + overlays. */
function Shell({
  workspaceId,
  workspaceDocId
}: {
  workspaceId: string
  workspaceDocId: Id<'workspaces'>
}): React.JSX.Element {
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const navOpen = useUiStore((state) => state.navOpen)
  const setNavOpen = useUiStore((state) => state.setNavOpen)
  // Left sidebar is an inline column at md+ and a slide-in drawer below md.
  // (The right panel's breakpoint is xl, handled in the channel page.)
  const isMdUp = useMediaQuery('(min-width: 768px)')
  // Desktop-only collapse (persisted). Below md the sidebar is a drawer, so the
  // collapse doesn't apply there — the hamburger opens/closes it instead.
  const sidebarHidden = sidebarCollapsed && isMdUp

  // A thread belongs to one workspace. Carrying `activeThreadId` across a switch would
  // query a thread you can't see.
  //
  // **On an actual change, not on mount.** Opening a thread notification from another
  // workspace sets `activeThreadId` and *then* navigates; the shell re-resolves the new
  // slug, remounts, and a mount-time `closeThread()` would wipe the id that was just
  // set — you'd land in the right channel with no thread panel, and only for
  // cross-workspace rows, which is what made it look intermittent.
  const previousWorkspace = useRef(workspaceId)
  useEffect(() => {
    if (previousWorkspace.current === workspaceId) return
    previousWorkspace.current = workspaceId
    useUiStore.getState().closeThread()
  }, [workspaceId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        useUiStore.getState().togglePalette()
      } else if (event.key === 'Escape') {
        const ui = useUiStore.getState()
        ui.setInboxOpen(false)
        ui.setSettingsOpen(false)
        ui.setThreadsOpen(false)
        ui.setEventsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <VoiceCallProvider>
      <div className="relative flex h-full overflow-hidden bg-card">
        {/* Sidebar: a persistent resizable column on desktop; below md it becomes a
            slide-in drawer over the content (Slack/Notion-style), toggled from the
            header hamburger. Hidden entirely when collapsed (desktop). */}
        {!sidebarHidden ? (
          <div
            className={cn(
              'z-40 flex shrink-0 border-r border-border bg-sidebar',
              'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-[85dvw] max-md:max-w-80 max-md:shadow-2xl max-md:transition-transform max-md:duration-200',
              navOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'
            )}
            style={isMdUp ? { width: sidebarWidth } : undefined}
          >
            <RealChannelSidebar serverId={workspaceId} />
          </div>
        ) : null}

        {isMdUp && !sidebarHidden ? (
          <ResizeHandle
            onDelta={(dx) => setSidebarWidth(useUiStore.getState().sidebarWidth + dx)}
          />
        ) : null}

        {navOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
          />
        ) : null}

        {/* The directory (members + channels) resolves `@user` / `#channel` mentions
            and backs the author profile card. It sits above BOTH the Outlet and the
            right panel — a thread's replies render in the panel and need it too. */}
        <WorkspaceDirectoryProvider slug={workspaceId} workspaceId={workspaceDocId}>
          {/* The content column: an event reminder sits ABOVE whatever you're looking
              at (channel, board, calendar), because it's about to happen wherever you
              are. A sibling of the Outlet, so navigating never remounts it. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <EventReminderBanner workspaceId={workspaceDocId} workspaceSlug={workspaceId} />
            <div className="flex min-h-0 min-w-0 flex-1">
              <Outlet />
            </div>
          </div>
          {/* Workspace-level right panel: a sibling of the Outlet, so channel
              navigation never tears it down. */}
          <WorkspaceRightPanel workspaceId={workspaceDocId} workspaceSlug={workspaceId} />
        </WorkspaceDirectoryProvider>

        <SettingsDialog workspaceSlug={workspaceId} />
        <CommandPalette serverId={workspaceId} workspaceDocId={workspaceDocId} />
      </div>
    </VoiceCallProvider>
  )
}
