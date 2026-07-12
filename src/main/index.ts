import { app, shell, BrowserWindow, ipcMain, session, desktopCapturer } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerAuthIpc } from './auth'
import { registerLocalDataIpc } from './local-data'

let mainWindow: BrowserWindow | null = null

// Deep links: `zinx://invite/<code>`, `zinx://connect/<token>`, `zinx://w/<slug>/…`.
// These carry a ROUTE into the app ("Open in app" from a web page / email) — NOT the
// auth handshake (that runs entirely in the in-app login window; see auth.ts). A cold
// start delivers the URL via `process.argv` (Win/Linux); it's buffered here until the
// renderer pulls it (`deep-link:get-initial`). A warm launch delivers it via
// `second-instance` (Win/Linux) or `open-url` (macOS) and is pushed straight to the
// running renderer.
let pendingDeepLink: string | null = null

/** The first `zinx://…` URL in an argv list, or null. */
function deepLinkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith('zinx://')) ?? null
}

/** Deliver a deep link. If a window is up, focus it and push the URL to the renderer;
 *  otherwise buffer it for the renderer's initial pull once it mounts. */
function dispatchDeepLink(url: string): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    mainWindow.webContents.send('deep-link', url)
  } else {
    pendingDeepLink = url
  }
}

// Screen-share source selection (Discord-style custom picker). The renderer's picker
// fetches sources (thumbnails), the user picks one, and we store its **id**. The
// display-media handler then re-fetches sources FRESH and captures the one matching
// that id — a source object/handle from the picker's earlier fetch goes stale, and
// capturing a stale source fails with "Error starting capture". Screen/window ids are
// stable across `getSources` calls, so matching by id in the fresh fetch is reliable.
let pendingScreenSourceId: string | null = null
let pendingScreenShareAudio = false

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    // Wide enough to clear the `lg` (1024px) breakpoint, so the three-column
    // layout (sidebar · conversation · members) is the default desktop view.
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // zinx-threads security non-negotiables (see CLAUDE.md) — do not disable.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Mirror native window fullscreen state to the renderer so the call view can sync
  // (the user may exit via F11/menu, not just our button).
  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window-fullscreen-changed', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window-fullscreen-changed', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Single-instance lock: keep one running app. A second launch focuses the existing
// window instead of spawning a duplicate process.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// Register `zinx://` as this app's deep-link scheme. In dev (`process.defaultApp`,
// running the electron binary against our entry) the scheme must point at that binary
// with our entry path; a packaged build registers itself. electron-builder.yml also
// declares the scheme so the installer registers it on the user's machine.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('zinx', process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('zinx')
}

// Cold start: the launching deep link (if any) rides in on our own argv.
pendingDeepLink = deepLinkFromArgv(process.argv)

app.on('second-instance', (_event, argv) => {
  const url = deepLinkFromArgv(argv)
  if (url) {
    dispatchDeepLink(url)
  } else if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// macOS delivers deep links here (can fire before the window exists → buffered).
app.on('open-url', (event, url) => {
  event.preventDefault()
  dispatchDeepLink(url)
})

/** Grant only the permissions voice/video calls need — microphone + camera +
 *  screen capture. Everything else is denied (never blanket-grant). */
function configureMediaPermissions(): void {
  const ses = session.defaultSession

  // getUserMedia (mic/camera) = `media`; getDisplayMedia (screen share) is also
  // gated by `display-capture`; the HTML fullscreen API (the call stage's
  // fullscreen button) is gated by `fullscreen`; the async Clipboard API's
  // `navigator.clipboard.writeText` is gated by `clipboard-sanitized-write` (denying
  // it silently REJECTS every copy — Copy link/ID/message do nothing). Allow exactly
  // these, deny everything else. (Denying display-capture makes screen share fail
  // with "Error starting capture"; denying fullscreen makes requestFullscreen a
  // silent no-op.)
  const allowed = (permission: string): boolean =>
    permission === 'media' ||
    permission === 'display-capture' ||
    permission === 'fullscreen' ||
    permission === 'clipboard-sanitized-write'
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowed(permission))
  })
  ses.setPermissionCheckHandler((_webContents, permission) => allowed(permission))

  // getDisplayMedia (screen share). Re-fetch sources FRESH here and capture the one
  // whose id the renderer's picker recorded (`set-screen-share-source`) — a source
  // held from the picker's earlier fetch goes stale and fails with "Error starting
  // capture". Optionally add system audio (loopback, Windows). We ALWAYS provide a
  // `video` track — never `callback({})` — because an empty/videoless callback throws
  // Electron's "Video was requested, but no video stream was provided" asynchronously
  // (uncatchable → an unhandled rejection + a dead share); if no source exists at all
  // we just don't call the callback (getDisplayMedia rejects renderer-side, no crash).
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    const wantId = pendingScreenSourceId
    const includeAudio = pendingScreenShareAudio
    pendingScreenSourceId = null
    pendingScreenShareAudio = false
    void desktopCapturer
      .getSources({ types: ['screen', 'window'] })
      .then((sources) => {
        const chosen =
          (wantId ? sources.find((source) => source.id === wantId) : undefined) ??
          sources.find((source) => source.id.startsWith('screen:')) ??
          sources[0]
        if (chosen) {
          callback(includeAudio ? { video: chosen, audio: 'loopback' } : { video: chosen })
        }
      })
      .catch(() => {})
  })
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.zinxthreads.app')

  // WorkOS sign-in runs in the main process (PKCE + token vault + in-app login window).
  // See src/main/auth.ts.
  registerAuthIpc(() => mainWindow)

  // Offline workspaces — one folder per workspace under userData/offline-workspaces.
  // See src/main/local-data.ts.
  registerLocalDataIpc()

  configureMediaPermissions()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Open external links in the OS default browser. Validate the input (never
  // trust the renderer) and only allow http/https so this can't be abused to
  // launch arbitrary protocols/files.
  ipcMain.handle('open-external', async (_event, url: unknown) => {
    if (typeof url !== 'string') return
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      await shell.openExternal(parsed.href)
    }
  })

  // Reveal the app's data directory in the OS file manager. This is where the
  // renderer's localStorage (offline pages/boards + settings) is persisted, so it
  // backs the settings "Open data folder" affordance. No renderer input is trusted —
  // the path is fixed to Electron's own `userData` dir.
  ipcMain.handle('open-data-folder', async () => {
    const dir = app.getPath('userData')
    const error = await shell.openPath(dir)
    if (error) console.error('[main] openPath failed:', error)
    return dir
  })

  // Screen-share picker: return the available screens/windows (with thumbnails) so
  // the renderer can show a chooser, and record which one the user selected.
  ipcMain.handle('get-screen-sources', async () => {
    // Try richest options first; on some Windows GPU/DWM setups thumbnail capture
    // and `fetchWindowIcons` fail (or throw) and return an empty list — so fall back
    // progressively rather than showing "No screens available". Log the reason.
    const attempt = async (
      options: Electron.SourcesOptions
    ): Promise<Electron.DesktopCapturerSource[]> => {
      try {
        return await desktopCapturer.getSources(options)
      } catch (error) {
        console.error('[main] desktopCapturer.getSources failed:', error)
        return []
      }
    }
    let sources = await attempt({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true
    })
    if (sources.length === 0) sources = await attempt({ types: ['screen', 'window'] })
    if (sources.length === 0) sources = await attempt({ types: ['screen'] })
    console.debug(`[main] screen sources found: ${sources.length}`)
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail:
        source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '',
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
      isScreen: source.id.startsWith('screen:')
    }))
  })
  // Record only the id — the display-media handler re-fetches fresh + matches by it.
  ipcMain.handle('set-screen-share-source', (_event, id: unknown, audio: unknown) => {
    pendingScreenSourceId = typeof id === 'string' ? id : null
    pendingScreenShareAudio = audio === true
  })

  // Hand the renderer the deep link that cold-started the app (if any), once — the
  // renderer pulls this on mount, since a launch URL arrives before it can subscribe.
  ipcMain.handle('deep-link:get-initial', () => {
    const url = pendingDeepLink
    pendingDeepLink = null
    return url
  })

  // Native window fullscreen for the call stage. Paired with the renderer's HTML
  // fullscreen (which stretches the call element over the viewport) so the pair is
  // a true whole-display experience even where HTML fullscreen alone doesn't take
  // the OS window fullscreen. Boolean-validated; never trust the renderer.
  ipcMain.handle('set-window-fullscreen', (_event, flag: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(flag === true)
    }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
