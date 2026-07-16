import { useEffect } from 'react'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { LocalSidebar } from '@renderer/components/local/local-sidebar'
import { LocalSettingsDialog } from '@renderer/components/local/local-settings-dialog'
import { LocalCommandPalette } from '@renderer/components/local/local-command-palette'
import { ResizeHandle } from '@renderer/components/layout/resize-handle'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { ensureLocalDataLoaded } from '@renderer/lib/local-data'
import { isElectron } from '@renderer/lib/platform'
import { useLocalStore } from '@renderer/store/local-store'
import { useUiStore } from '@renderer/store/ui-store'

export const Route = createFileRoute('/local')({
  // Offline mode is DESKTOP ONLY — it persists to a folder on disk, which a browser
  // tab can't do. A web visit (even a direct /local URL) bounces home so the feature
  // isn't exposed there.
  beforeLoad: () => {
    if (!isElectron) throw redirect({ to: '/' })
  },
  component: LocalLayout
})

/** The **offline workspace** shell — a standalone, no-auth experience (AuthGate lets
 *  `/local*` through). Mirrors the online shell: a resizable + collapsible sidebar
 *  (shared widths via `ui-store`) beside the active channel. All data lives in
 *  `store/local-store`, persisted by `lib/local-data.ts` (one FOLDER per workspace
 *  on desktop, localStorage on web); nothing here touches Convex. */
function LocalLayout(): React.JSX.Element {
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const hydrated = useLocalStore((state) => state.hydrated)

  // Hydrate the offline store (reads the workspace folders on desktop) — idempotent.
  useEffect(() => {
    ensureLocalDataLoaded()
  }, [])

  if (!hydrated) {
    return (
      <div className="flex h-full overflow-hidden bg-card">
        <LoadingBlock />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden bg-card">
      {!sidebarCollapsed ? (
        <>
          <div
            className="flex shrink-0 flex-col border-r border-border bg-sidebar"
            style={{ width: sidebarWidth }}
          >
            <LocalSidebar />
          </div>
          <ResizeHandle
            onDelta={(dx) => setSidebarWidth(useUiStore.getState().sidebarWidth + dx)}
          />
        </>
      ) : null}

      <Outlet />

      <LocalSettingsDialog />
      <LocalCommandPalette />
    </div>
  )
}
