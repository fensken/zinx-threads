import { useEffect } from 'react'
import { Outlet, createFileRoute } from '@tanstack/react-router'
import { ChannelSidebar } from '@renderer/components/app-shell/channel-sidebar'
import { ServerRail } from '@renderer/components/app-shell/server-rail'
import { ResizeHandle } from '@renderer/components/app-shell/resize-handle'
import { SettingsDialog } from '@renderer/components/app-shell/settings-dialog'
import { CommandPalette } from '@renderer/components/app-shell/command-palette'
import { getServer } from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useMediaQuery } from '@renderer/lib/use-media-query'
import { cn } from '@renderer/lib/utils'

export const Route = createFileRoute('/w/$workspaceId')({
  component: ServerLayout
})

function ServerLayout(): React.JSX.Element {
  const { workspaceId } = Route.useParams()
  const server = getServer(workspaceId)
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const navOpen = useUiStore((state) => state.navOpen)
  const setNavOpen = useUiStore((state) => state.setNavOpen)
  const showServerRail = useSettingsStore((state) => state.showServerRail)
  const isWide = useMediaQuery('(min-width: 1024px)')

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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!server) {
    return (
      <div className="flex h-screen items-center justify-center bg-card text-muted-foreground">
        Server “{workspaceId}” not found.
      </div>
    )
  }

  return (
    <div className="relative flex h-screen overflow-hidden bg-card">
      {/* Optional Discord-style workspace rail (desktop only; on compact, switch
          workspaces via the sidebar dropdown). */}
      {showServerRail && isWide ? <ServerRail /> : null}

      {/* Sidebar: a persistent resizable column on desktop; below lg it becomes a
          slide-in drawer over the content (Slack/Notion-style), toggled from the
          header hamburger. Inline width only applies on desktop so the drawer can
          use its own responsive width. */}
      <div
        className={cn(
          'z-40 flex shrink-0 border-r border-border bg-sidebar',
          'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:w-[85vw] max-lg:max-w-80 max-lg:shadow-2xl max-lg:transition-transform max-lg:duration-200',
          navOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'
        )}
        style={isWide ? { width: sidebarWidth } : undefined}
      >
        <ChannelSidebar serverId={workspaceId} />
      </div>

      {isWide ? (
        <ResizeHandle onDelta={(dx) => setSidebarWidth(useUiStore.getState().sidebarWidth + dx)} />
      ) : null}

      {navOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      ) : null}

      <Outlet />
      <SettingsDialog />
      <CommandPalette serverId={workspaceId} />
    </div>
  )
}
