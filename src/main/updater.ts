import { app, ipcMain, type BrowserWindow } from 'electron'
import updater from 'electron-updater'

const { autoUpdater } = updater

/** The GitHub Releases repo the app updates from — mirrors `electron-builder.yml`'s `publish`
 *  target. Used by the manual check below (electron-updater reads its own copy from the bundled
 *  `app-update.yml`). */
const REPO = 'fensken/zinx-threads'

/** How often to re-check after the first check on launch. A desktop app stays open for hours; a
 *  beta user shouldn't have to restart to pick up a new build. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** What the renderer's title-bar "Update available" badge renders from. */
export interface UpdateState {
  /** A newer version exists (from electron-updater OR the manual GitHub check). */
  available: boolean
  /** electron-updater finished downloading it → one-click "Restart to update" (Windows/Linux;
   *  never true on unsigned macOS, where Squirrel refuses the update). */
  downloaded: boolean
  /** The newer version, for the tooltip. */
  version: string | null
  /** The release page — where a manual/macOS user downloads it when self-install isn't possible. */
  url: string | null
}

let state: UpdateState = { available: false, downloaded: false, version: null, url: null }
let getWindow: () => BrowserWindow | null = () => null

function broadcast(): void {
  const window = getWindow()
  if (window && !window.isDestroyed()) window.webContents.send('update:state', state)
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast()
}

function releaseUrl(version: string): string {
  return `https://github.com/${REPO}/releases/tag/v${version}`
}

/**
 * Is `candidate` a newer version than `current`? A small semver-with-prerelease comparison for our
 * `X.Y.Z` / `X.Y.Z-beta.N` scheme (release beats any prerelease of the same core; higher `beta.N`
 * beats lower). Kept tiny + local rather than pulling a semver dep into the main bundle — the
 * version shape here is fully under our control (`package.json`).
 */
function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string): number[] => {
    const [core, pre] = v.split('-')
    const nums = core.split('.').map((n) => Number(n) || 0)
    // No prerelease sorts ABOVE a prerelease of the same core, so give it +Infinity.
    nums.push(pre ? Number(pre.replace(/\D/g, '')) || 0 : Number.POSITIVE_INFINITY)
    return nums
  }
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** Ask GitHub directly whether a newer release exists. This is the ONLY "update available" signal
 *  on unsigned macOS (electron-updater can't run there), and it surfaces the badge a bit sooner
 *  everywhere. Best-effort — a failed fetch just leaves the state unchanged. */
async function manualCheck(): Promise<void> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!response.ok) return
    const releases = (await response.json()) as Array<{
      tag_name: string
      draft: boolean
      html_url: string
    }>
    const latest = releases.find((release) => !release.draft) // published; prereleases allowed
    if (!latest) return
    const version = String(latest.tag_name).replace(/^v/, '')
    if (isNewer(version, app.getVersion())) {
      setState({ available: true, version, url: latest.html_url })
    }
  } catch {
    // offline / rate-limited — the badge simply doesn't appear
  }
}

/**
 * Auto-update via `electron-updater` against the GitHub Releases target in `electron-builder.yml`,
 * plus an in-app "Update available" badge (title bar). Only runs in a PACKAGED build.
 *
 * `checkForUpdatesAndNotify` downloads a newer version in the background and installs it on the next
 * quit; the badge lets the user trigger the install (restart) immediately, or — on unsigned macOS,
 * where Squirrel refuses to self-install — sends them to the release page to download it.
 *
 * Nothing here can crash the app: a failed/unsupported check is logged and swallowed.
 */
export function initAutoUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter

  // The renderer pulls the current state on mount (it may miss the early broadcasts) and can
  // trigger the install.
  ipcMain.handle('update:get-state', () => state)
  ipcMain.handle('update:install', () => {
    if (!state.downloaded) return false
    // Installs the staged update and relaunches. `isSilent`/`isForceRunAfter` = quiet reinstall.
    autoUpdater.quitAndInstall(true, true)
    return true
  })

  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Beta builds carry a `-beta.N` prerelease tag, so updates flow on the prerelease channel.
  // electron-updater ignores prereleases unless this is set. Flip to `false` at 1.0.0.
  autoUpdater.allowPrerelease = true

  autoUpdater.on('error', (error) => console.error('[updater]', error?.message ?? error))
  autoUpdater.on('update-available', (info) => {
    console.info('[updater] update available', info.version)
    setState({ available: true, version: info.version, url: releaseUrl(info.version) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.info('[updater] update downloaded — ready to install', info.version)
    setState({
      available: true,
      downloaded: true,
      version: info.version,
      url: releaseUrl(info.version)
    })
  })

  const check = (): void => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      console.error('[updater] check failed', error?.message ?? error)
    })
    void manualCheck()
  }
  check()
  setInterval(check, CHECK_INTERVAL_MS)
}
