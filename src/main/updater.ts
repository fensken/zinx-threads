import { app, ipcMain, type BrowserWindow } from 'electron'
import updater from 'electron-updater'
import { markQuitting } from './system-integration'

const { autoUpdater } = updater

/**
 * Auto-update, Discord-style: **the app updates itself and nothing is ever downloaded by hand.**
 *
 * The whole lifecycle happens in-process against the `latest*.yml` manifests that
 * `electron-builder --publish` uploads alongside the installers (see `electron-builder.yml` and
 * RELEASING.md):
 *
 *  1. **On launch** (and every 6h after) we check for a newer version.
 *  2. If there is one it **downloads in the background** — the user isn't asked and isn't blocked.
 *  3. Once staged, it **installs on quit** (`autoInstallOnAppQuit`), so simply closing the app
 *     and reopening it lands on the new version. That is the "auto-update on startup" behaviour.
 *  4. The title-bar badge lets the user take it **now** instead of waiting for a quit — one click
 *     relaunches into the staged build (`update:install` → `quitAndInstall`).
 *
 * There is deliberately **no "go download it yourself" path**. Squirrel (macOS) and NSIS (Windows)
 * can only self-install a **signed** build, so the code signing described in RELEASING.md is what
 * makes this whole flow work; an unsigned build fails the download/install step and reports an
 * error phase rather than sending the user to a browser.
 *
 * Nothing here can crash the app: every check/download failure is caught and surfaced as an
 * `error` phase.
 */

/** How often to re-check after the launch check. A desktop app stays open for days; waiting for a
 *  restart to even notice a release would make updates arrive far too late. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Where the update flow currently is. The renderer's badge renders straight off this. */
export type UpdatePhase =
  /** No update known (or not a packaged build). The badge renders nothing. */
  | 'idle'
  /** A check is in flight. */
  | 'checking'
  /** A newer version exists; the background download hasn't finished yet. */
  | 'available'
  /** Actively downloading — `percent` is live. */
  | 'downloading'
  /** Downloaded + staged. One click installs and relaunches; a plain quit also applies it. */
  | 'ready'
  /** The last check or download failed. `message` says why, in user-facing terms. */
  | 'error'

/** What the renderer's title-bar update badge renders from. */
export interface UpdateState {
  phase: UpdatePhase
  /** The version currently running — constant, but the settings pane needs it beside the phase. */
  currentVersion: string
  /** The newer version, once known (e.g. `1.2.0`). */
  version: string | null
  /** Download progress, 0–100. Only meaningful while `phase === 'downloading'`. */
  percent: number
  /** A short, user-facing reason for `phase === 'error'`. Never a stack trace or a URL. */
  message: string | null
}

let state: UpdateState = {
  phase: 'idle',
  // `app.getVersion()` reads package.json's `version` — the value electron-builder also names
  // the artifacts and the update manifests from, so this is the same string the updater compares.
  currentVersion: app.getVersion(),
  version: null,
  percent: 0,
  message: null
}

let getWindow: () => BrowserWindow | null = () => null
/** Guards against overlapping checks (the interval firing while a manual check is in flight). */
let checking = false

function broadcast(): void {
  const window = getWindow()
  if (window && !window.isDestroyed()) window.webContents.send('update:state', state)
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast()
}

/**
 * Turn an updater failure into something worth showing a user. electron-updater's messages carry
 * release URLs, HTTP bodies and stack traces — none of which belong in the UI (the "never expose
 * internals" rule) — so the raw error is logged and only a category is surfaced.
 */
function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  console.error('[updater]', error)
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ENETUNREACH|net::/i.test(raw)) {
    return "Couldn't reach the update server."
  }
  // Squirrel/NSIS refuse to apply a build whose signature doesn't match the installed app.
  if (/signature|not signed|code sign/i.test(raw)) {
    return 'The update could not be verified.'
  }
  return "The update couldn't be installed."
}

/** Run a check now. Safe to call repeatedly — overlapping calls are dropped. */
async function check(): Promise<void> {
  // Never interrupt a download or discard a staged update by re-checking over it.
  if (checking || state.phase === 'downloading' || state.phase === 'ready') return
  checking = true
  setState({ phase: 'checking', message: null })
  try {
    await autoUpdater.checkForUpdates()
    // The `update-available` / `update-not-available` handlers below have already moved us to the
    // right phase. Only settle it here if neither fired (a disabled updater resolves null without
    // emitting anything), so a check can't leave the badge stuck on "checking".
    if (state.phase === 'checking') setState({ phase: 'idle' })
  } catch (error) {
    setState({ phase: 'error', message: describeError(error) })
  } finally {
    checking = false
  }
}

/**
 * Wire the auto-updater and its IPC. Call once from `whenReady`.
 *
 * The IPC handlers are registered in **every** build (so the renderer's badge never talks to a
 * missing channel in dev), but the updater itself only runs when packaged.
 */
export function initAutoUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter

  // The renderer pulls state on mount — the launch check can resolve before it has subscribed.
  ipcMain.handle('update:get-state', () => state)

  // Let the user re-check by hand (Settings → a "Check for updates" button), e.g. after a failure.
  ipcMain.handle('update:check', async () => {
    if (app.isPackaged) await check()
    return state
  })

  // Start (or retry) the download. Normally unnecessary — `autoDownload` handles it — but it makes
  // the badge actionable in the transient `available` phase and after an error.
  ipcMain.handle('update:download', async () => {
    if (!app.isPackaged || state.phase === 'downloading' || state.phase === 'ready') return state
    try {
      setState({ phase: 'downloading', percent: 0, message: null })
      await autoUpdater.downloadUpdate()
    } catch (error) {
      setState({ phase: 'error', message: describeError(error) })
    }
    return state
  })

  // Relaunch into the staged update.
  ipcMain.handle('update:install', () => {
    if (state.phase !== 'ready') return false
    // Tell the window's close handler this is a genuine quit, not a close-to-tray — otherwise
    // run-in-background would swallow the close and the install would never happen.
    markQuitting()
    // `isSilent` + `isForceRunAfter`: apply quietly and come back up on the new version.
    autoUpdater.quitAndInstall(true, true)
    return true
  })

  if (!app.isPackaged) return

  // Download without asking, and apply on quit — so a user who never touches the badge still ends
  // up on the new version the next time they open the app.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Beta builds carry a `-beta.N` prerelease tag, so updates flow on the prerelease channel.
  // electron-updater ignores prereleases unless this is set. Flip to `false` at 1.0.0 so stable
  // users stop being offered betas.
  autoUpdater.allowPrerelease = true

  autoUpdater.on('error', (error) => {
    setState({ phase: 'error', message: describeError(error) })
  })
  autoUpdater.on('update-available', (info) => {
    console.info('[updater] update available', info.version)
    // `autoDownload` starts immediately, so go straight to `downloading`; `download-progress`
    // will fill in the percent. (`available` remains the phase if the download has to be
    // triggered by hand.)
    setState({ phase: 'downloading', version: info.version, percent: 0, message: null })
  })
  autoUpdater.on('update-not-available', () => {
    setState({ phase: 'idle', version: null, percent: 0, message: null })
  })
  autoUpdater.on('download-progress', (progress) => {
    setState({ phase: 'downloading', percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.info('[updater] update staged — will install on quit', info.version)
    setState({ phase: 'ready', version: info.version, percent: 100, message: null })
  })

  void check()
  const timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
  // Don't let the interval hold the process open during a quit/install.
  timer.unref?.()
}
