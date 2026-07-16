import { app, Tray, Menu, nativeImage, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import trayIconAsset from '../../resources/icon.png?asset'
import { BRAND } from '../shared/brand'

/**
 * Desktop "lives in the tray" behaviour — the two options Discord/Slack expose:
 *
 *  1. **Launch at startup** — registered with the OS via `app.setLoginItemSettings`. The OS is the
 *     store, so there's nothing to persist ourselves.
 *  2. **Run in background** — closing the window HIDES it to a system-tray icon and keeps the app
 *     running, instead of quitting. Persisted to a small JSON file in `userData` because the
 *     window-`close` handler needs to know the choice at close time, before the renderer is asked.
 *
 * The renderer only toggles these (Settings); every OS interaction lives here. `isQuitting()` lets
 * the window's `close` handler tell a real quit (tray → Quit, `Cmd+Q`, updater install) apart from
 * a close-to-tray.
 */

let tray: Tray | null = null
let runInBackground = false
let quitting = false

/** True once the user has genuinely asked to quit — so the window's `close` handler stops
 *  intercepting and lets the app exit. */
export function isQuitting(): boolean {
  return quitting
}

/** Whether a window `close` should hide-to-tray instead of closing (run-in-background, not a real
 *  quit). Read by `createWindow`'s `close` handler. */
export function shouldHideOnClose(): boolean {
  return runInBackground && !quitting
}

function prefsPath(): string {
  return join(app.getPath('userData'), 'window-prefs.json')
}
function loadRunInBackground(): boolean {
  try {
    return (
      existsSync(prefsPath()) &&
      JSON.parse(readFileSync(prefsPath(), 'utf8')).runInBackground === true
    )
  } catch {
    return false
  }
}
function saveRunInBackground(value: boolean): void {
  try {
    writeFileSync(prefsPath(), JSON.stringify({ runInBackground: value }))
  } catch {
    // A failed write just means the choice won't survive a restart — not worth failing over.
  }
}

/** A small tray icon from the app image (16px — a tray icon must be tiny). The `?asset` import
 *  resolves to the right file path in both dev and a packaged build. */
function trayImage(): Electron.NativeImage {
  const image = nativeImage.createFromPath(trayIconAsset)
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 })
}

function ensureTray(showWindow: () => void): void {
  if (tray) return
  tray = new Tray(trayImage())
  tray.setToolTip(BRAND.productName)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${BRAND.productName}`, click: showWindow },
      { type: 'separator' },
      {
        label: `Quit ${BRAND.productName}`,
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  // Windows/Linux: clicking the tray icon reopens the window (macOS uses the dock/menu instead).
  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/**
 * Wire the login-item + run-in-background settings and their IPC. Call once, from `whenReady`,
 * with a getter for the main window (it may be recreated, so a getter, not the window itself).
 */
export function registerSystemIntegration(getWindow: () => BrowserWindow | null): void {
  runInBackground = loadRunInBackground()

  const showWindow = (): void => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  // Already opted into background at last run → put the tray up now.
  if (runInBackground) ensureTray(showWindow)

  // Any genuine quit path (menu, Cmd+Q, updater) flips the flag so the window's `close` handler
  // stops hiding-to-tray and actually lets the app exit.
  app.on('before-quit', () => {
    quitting = true
  })

  ipcMain.handle('system:get-prefs', () => ({
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    runInBackground
  }))

  ipcMain.handle('system:set-open-at-login', (_event, value: unknown) => {
    const open = value === true
    // The OS is the store. `openAsHidden` (macOS) starts it minimised at login, matching the
    // "runs quietly in the background" expectation; Windows ignores it harmlessly.
    app.setLoginItemSettings({ openAtLogin: open, openAsHidden: open })
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('system:set-run-in-background', (_event, value: unknown) => {
    runInBackground = value === true
    saveRunInBackground(runInBackground)
    if (runInBackground) {
      ensureTray(showWindow)
    } else {
      destroyTray()
      // Turning it off while the window is hidden would strand the user with no way back — the
      // tray they'd use is the very thing we just removed. So make sure it's visible.
      showWindow()
    }
    return runInBackground
  })
}
