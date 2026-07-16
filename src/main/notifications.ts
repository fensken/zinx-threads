import { BrowserWindow, Notification, app, ipcMain, nativeImage } from 'electron'
import { join } from 'path'

/**
 * OS notifications.
 *
 * **The renderer decides *whether*; main only decides *how*.** The renderer is the
 * only side that knows what arrived, whether the window was focused when it did, and
 * where clicking it should go — so it sends a finished notification (title, body, and
 * an opaque `route` to return on click) and main just shows it. That keeps every
 * "should this interrupt them?" rule in one place instead of split across the IPC
 * boundary.
 *
 * The click round-trips: main focuses the window and hands the `route` back, and the
 * renderer navigates. Main never learns what a channel or a DM is.
 */

/** The taskbar/dock icon shown on the notification. Falls back silently — a
 *  notification with no icon is fine; a crash isn't. */
function icon(): Electron.NativeImage | undefined {
  try {
    const image = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
    return image.isEmpty() ? undefined : image
  } catch {
    return undefined
  }
}

export interface NotifyPayload {
  title: string
  body: string
  /** Opaque to main — handed straight back on click so the renderer can navigate. */
  route?: string
  /** True when the renderer already played our own chime, so the OS shouldn't add
   *  its own on top. (We prefer ours: it's the same sound in-app and out.) */
  silent?: boolean
  /** Coalescing key. A new notification with the same tag REPLACES the previous one
   *  rather than stacking a second banner — Electron has no `tag` option of its own,
   *  so we close the prior same-tag notification before showing the new one. Without
   *  it, spamming a source (the settings "test" button) piles up N banners. */
  tag?: string
}

function isNotifyPayload(value: unknown): value is NotifyPayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Record<string, unknown>
  return typeof payload.title === 'string' && typeof payload.body === 'string'
}

/** The most recent notification shown under each tag, so a later one can close it. Untagged
 *  notifications are never tracked (each is its own distinct event). Cleaned up on close/click. */
const activeByTag = new Map<string, Notification>()

export function registerNotificationIpc(getWindow: () => BrowserWindow | null): void {
  // Show an OS notification. Validated, never trusted (the CLAUDE.md rule for every
  // IPC input) — a malformed payload is dropped, not passed to Electron.
  ipcMain.handle('notify', (_event, payload: unknown) => {
    if (!isNotifyPayload(payload)) return false
    if (!Notification.isSupported()) return false

    const tag =
      typeof payload.tag === 'string' && payload.tag ? payload.tag.slice(0, 64) : undefined
    // Replace, don't stack: close the previous banner sharing this tag first.
    if (tag) {
      activeByTag.get(tag)?.close()
      activeByTag.delete(tag)
    }

    const notification = new Notification({
      title: payload.title.slice(0, 120),
      body: payload.body.slice(0, 400),
      // We play our own chime in the renderer, so the OS one would double up.
      silent: payload.silent !== false,
      icon: icon()
    })

    const forget = (): void => {
      if (tag && activeByTag.get(tag) === notification) activeByTag.delete(tag)
    }
    notification.on('close', forget)
    notification.on('click', () => {
      forget()
      const window = getWindow()
      if (!window || window.isDestroyed()) return
      // Clicking a notification means "take me there" — so restore, raise and focus.
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      if (payload.route) window.webContents.send('notification:click', payload.route)
    })

    notification.show()
    if (tag) activeByTag.set(tag, notification)
    return true
  })

  // The unread count on the dock (macOS) / taskbar (Linux). Windows has no numeric
  // badge — `setBadgeCount` is a documented no-op there, so this is simply quieter on
  // Windows rather than wrong.
  ipcMain.handle('set-badge-count', (_event, count: unknown) => {
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return
    try {
      app.setBadgeCount(Math.min(Math.floor(count), 9999))
    } catch {
      // Unsupported platform — not worth failing the call over.
    }
  })
}
