import { useCallback, useEffect, useState } from 'react'
import { BRAND } from '@shared/brand'
import { platform, type SystemPrefs, type UpdateState } from '@renderer/lib/platform'
import { Switch } from '@renderer/components/ui/switch'
import { Spinner } from '@renderer/components/ui/spinner'
import { Button } from '@renderer/components/ui/button'

/**
 * "Startup & tray" — launch-at-startup + run-in-background (close-to-tray), Discord/Slack-style.
 * Shared by the online and offline settings dialogs so the toggles read and behave identically in
 * both; both are app-level OS integrations that have nothing to do with a workspace or a sign-in.
 *
 * Desktop only. Callers gate on `platform.systemPrefs.supported()` (false on web, where there's no
 * login item or tray) and render nothing when it's false — this component assumes it's supported.
 *
 * The source of truth is the OS (the login item) and the main process (the tray flag), so this
 * loads the live values and reflects back whatever each setter confirms, rather than mirroring into
 * a store that could drift from the OS.
 */
export function SystemPrefsSettings(): React.JSX.Element {
  const [prefs, setPrefs] = useState<SystemPrefs | null>(null)

  useEffect(() => {
    let alive = true
    void platform.systemPrefs.get().then((value) => {
      if (alive) setPrefs(value)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!prefs) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Loading…
      </div>
    )
  }

  return (
    <div className="mb-6 last:mb-0">
      <h3 className="text-sm font-semibold">Startup &amp; tray</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Choose how {BRAND.productName} behaves when you sign in to your computer and when you close
        the window.
      </p>
      <div className="grid gap-3">
        <ToggleRow
          label="Open at login"
          hint={`Start ${BRAND.productName} automatically when you sign in to this computer.`}
          checked={prefs.openAtLogin}
          onChange={(next) => {
            // Reflect immediately, then correct to whatever the OS actually reports back.
            setPrefs((current) => (current ? { ...current, openAtLogin: next } : current))
            void platform.systemPrefs
              .setLaunchAtStartup(next)
              .then((confirmed) =>
                setPrefs((current) => (current ? { ...current, openAtLogin: confirmed } : current))
              )
          }}
        />
        <ToggleRow
          label="Keep running in the background"
          hint="Closing the window keeps the app in the tray so messages and calls still reach you. Quit it from the tray icon or the app menu."
          checked={prefs.runInBackground}
          onChange={(next) => {
            setPrefs((current) => (current ? { ...current, runInBackground: next } : current))
            void platform.systemPrefs
              .setRunInBackground(next)
              .then((confirmed) =>
                setPrefs((current) =>
                  current ? { ...current, runInBackground: confirmed } : current
                )
              )
          }}
        />
      </div>
      <UpdatesBlock />
    </div>
  )
}

/**
 * "Updates" — the version you're on, and a manual re-check.
 *
 * The app updates itself in the background (see `src/main/updater.ts`), so this is deliberately
 * *informational*: there is no "download" button because there is no manual download. It exists so
 * the version is findable when reporting a bug, and so someone who has just been told a fix shipped
 * can pull it now instead of waiting for the next 6-hourly check.
 */
function UpdatesBlock(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!platform.updates.supported()) return
    let alive = true
    void platform.updates.getState().then((value) => {
      if (alive) setState(value)
    })
    const unsubscribe = platform.updates.onStateChange(setState)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const check = useCallback(() => {
    setChecking(true)
    void platform.updates
      .check()
      .then(setState)
      .finally(() => setChecking(false))
  }, [])

  if (!platform.updates.supported() || !state) return null

  const busy = checking || state.phase === 'checking'
  // Only the terminal phases get a line of their own; `idle` after a check simply means up to date.
  const status =
    state.phase === 'downloading'
      ? `Downloading ${state.version ?? 'update'}… ${state.percent}%`
      : state.phase === 'ready'
        ? `Version ${state.version} is ready — restart to apply it.`
        : state.phase === 'available'
          ? `Version ${state.version} is available and will download automatically.`
          : state.phase === 'error'
            ? (state.message ?? 'The last update check failed.')
            : `${BRAND.productName} is up to date.`

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Updates</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        {BRAND.productName} installs updates by itself — you never have to download one.
      </p>
      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Version {state.currentVersion}</span>
          <span
            className={`block text-xs ${
              state.phase === 'error' ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {busy ? 'Checking for updates…' : status}
          </span>
        </span>
        {state.phase === 'ready' ? (
          <Button size="sm" className="shrink-0" onClick={() => void platform.updates.install()}>
            Restart now
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="shrink-0" disabled={busy} onClick={check}>
            {busy ? <Spinner className="size-4" /> : 'Check for updates'}
          </Button>
        )}
      </div>
    </div>
  )
}

/** A labelled switch. Clicking anywhere on the row toggles it — a large target for a setting beats
 *  a 20px one, and the label is what people aim at. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3 transition-colors hover:bg-accent/40">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </label>
  )
}
