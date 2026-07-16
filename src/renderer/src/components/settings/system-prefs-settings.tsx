import { useEffect, useState } from 'react'
import { BRAND } from '@shared/brand'
import { platform, type SystemPrefs } from '@renderer/lib/platform'
import { Switch } from '@renderer/components/ui/switch'
import { Spinner } from '@renderer/components/ui/spinner'

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
