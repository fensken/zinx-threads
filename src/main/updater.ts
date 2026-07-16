import { app } from 'electron'
import updater from 'electron-updater'

const { autoUpdater } = updater

/** How often to re-check after the first check on launch. A desktop app stays open for hours; a
 *  beta user shouldn't have to restart to pick up a new build. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Auto-update via `electron-updater` against the GitHub Releases target in `electron-builder.yml`.
 *
 * Only runs in a PACKAGED build — in dev there is no release feed and `checkForUpdates` throws.
 * `checkForUpdatesAndNotify` downloads a newer version in the background and shows an OS
 * notification when it's staged; it installs on the next quit (`autoInstallOnAppQuit`).
 *
 * Beta reality: **unsigned updates apply on Windows and Linux**, but macOS (Squirrel) refuses an
 * unsigned update — so a mac check surfaces an error, which we log and swallow (mac beta users
 * re-download manually until the app is signed + notarized). Nothing here can crash the app.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Beta builds carry a `-beta.N` prerelease tag, so updates flow on the `beta` channel
  // (`beta.yml`, not `latest.yml`). electron-updater ignores prereleases unless this is set — so a
  // `0.0.1-beta.1` install would never see `0.0.1-beta.2` without it. Flip to `false` at 1.0.0.
  autoUpdater.allowPrerelease = true
  autoUpdater.on('error', (error) => console.error('[updater]', error?.message ?? error))
  autoUpdater.on('update-available', (info) =>
    console.info('[updater] update available', info.version)
  )
  autoUpdater.on('update-downloaded', (info) =>
    console.info('[updater] update downloaded — installs on quit', info.version)
  )

  const check = (): void => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      console.error('[updater] check failed', error?.message ?? error)
    })
  }
  check()
  setInterval(check, CHECK_INTERVAL_MS)
}
