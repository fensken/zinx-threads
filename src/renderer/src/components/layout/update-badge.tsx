import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, DownloadSimple, WarningCircle } from '@phosphor-icons/react'
import { platform, type UpdateState } from '@renderer/lib/platform'

const EMPTY: UpdateState = {
  phase: 'idle',
  currentVersion: '',
  version: null,
  percent: 0,
  message: null
}

/**
 * The title-bar update pill (desktop only), just left of the window action buttons.
 *
 * The app updates **itself** — this never sends anyone to a browser to fetch an installer. It only
 * surfaces where the background flow in `src/main/updater.ts` has got to, and lets the user take a
 * staged update immediately instead of waiting for their next quit:
 *
 * - **downloading** — informational, not a button. Explains the restart prompt that's about to
 *   appear, and stops a click landing on nothing while bytes are still moving.
 * - **ready** — "Restart to update": relaunches into the new version now.
 * - **available** — the transient window before the automatic download starts (or after a failed
 *   one); clicking starts it.
 * - **error** — the check or download failed; clicking retries.
 *
 * `idle`/`checking` render nothing, so a healthy up-to-date app shows no chrome at all.
 */
export function UpdateBadge(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState>(EMPTY)

  useEffect(() => {
    // Pull current state on mount (the launch check can resolve before this mounts), then subscribe.
    void platform.updates.getState().then(setState)
    return platform.updates.onStateChange(setState)
  }, [])

  const { phase, version, percent, message } = state

  const onClick = useCallback(() => {
    if (phase === 'ready') void platform.updates.install()
    else if (phase === 'available') void platform.updates.download()
    else if (phase === 'error') void platform.updates.check()
  }, [phase])

  if (phase === 'idle' || phase === 'checking') return null

  const base = 'app-no-drag ml-auto mr-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2'

  // Downloading is a status, not an action — a button here would do nothing when clicked.
  if (phase === 'downloading') {
    return (
      <div
        className={`${base} bg-muted text-xs font-medium text-muted-foreground`}
        title={version ? `Downloading version ${version}` : 'Downloading update'}
      >
        <DownloadSimple className="size-4 shrink-0 animate-pulse" />
        <span className="whitespace-nowrap tabular-nums">
          {percent > 0 ? `Updating… ${percent}%` : 'Updating…'}
        </span>
      </div>
    )
  }

  const failed = phase === 'error'
  const ready = phase === 'ready'
  const Icon = failed ? WarningCircle : ready ? ArrowClockwise : DownloadSimple
  const label = failed ? 'Update failed' : ready ? 'Restart to update' : 'Update available'
  const title = failed
    ? `${message ?? 'The update failed.'} Click to try again.`
    : ready
      ? `Version ${version ?? 'update'} is ready — restart to apply it`
      : `Version ${version ?? 'update'} is available — click to download it`

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`${base} text-xs font-medium transition-colors ${
        failed
          ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
          : 'bg-primary/15 text-primary hover:bg-primary/25'
      }`}
    >
      <Icon className="size-4 shrink-0" weight={ready ? 'bold' : 'regular'} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
