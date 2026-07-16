import { useEffect, useState } from 'react'
import { ArrowClockwise, DownloadSimple } from '@phosphor-icons/react'
import { platform, type UpdateState } from '@renderer/lib/platform'

const EMPTY: UpdateState = { available: false, downloaded: false, version: null, url: null }

/**
 * The title-bar "Update available" pill (desktop only). Sits just left of the window
 * action buttons. Rendered only when the main-process updater reports a newer version.
 *
 * - **downloaded** (Windows/Linux, staged by electron-updater) → "Restart to update",
 *   click installs + relaunches immediately.
 * - **available only** (unsigned macOS, or before the background download finishes) →
 *   "Update available", click opens the release page to download.
 */
export function UpdateBadge(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState>(EMPTY)

  useEffect(() => {
    // Pull the current state on mount (early broadcasts may have fired before this mounted),
    // then keep in sync.
    void platform.updates.getState().then(setState)
    return platform.updates.onStateChange(setState)
  }, [])

  if (!state.available && !state.downloaded) return null

  const ready = state.downloaded
  const label = ready ? 'Restart to update' : 'Update available'
  const Icon = ready ? ArrowClockwise : DownloadSimple

  return (
    <button
      type="button"
      title={state.version ? `Version ${state.version} is available` : label}
      onClick={() => {
        if (ready) void platform.updates.install()
        else if (state.url) platform.openExternal(state.url)
      }}
      className="app-no-drag ml-auto mr-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary/15 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/25"
    >
      <Icon className="size-4 shrink-0" weight={ready ? 'bold' : 'regular'} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
