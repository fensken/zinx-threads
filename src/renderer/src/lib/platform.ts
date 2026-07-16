/**
 * Platform abstraction — lets the single `src/renderer` codebase run BOTH as the
 * Electron desktop app and as a plain web app.
 *
 * In Electron the preload bridge exposes `window.electron` / `window.api`; in a
 * browser those are absent. Every native capability is feature-detected here and
 * given a web fallback, so renderer code never has to know which target it's in.
 *
 * Rule: renderer code must reach native features ONLY through this module —
 * never touch `window.electron` / `window.api` directly. That keeps the web
 * build free of desktop-only assumptions (see CLAUDE.md).
 */

/** True when running inside the Electron renderer. Primarily the preload bridge
 *  (`window.electron`), but ALSO the Electron user-agent as a fallback — under
 *  `pnpm dev` a renderer reload can momentarily race the preload so `window.electron`
 *  is briefly undefined, and we must NOT then treat the desktop app as web (that's
 *  what made screen share skip our picker and grab the primary screen directly). */
export const isElectron: boolean =
  typeof window !== 'undefined' &&
  (typeof window.electron !== 'undefined' ||
    (typeof navigator !== 'undefined' && /\bElectron\//i.test(navigator.userAgent)))

/** True when running in a normal browser (web build). */
export const isWeb = !isElectron

/** True only when the preload BRIDGE actually loaded (so native IPC calls work).
 *  Distinct from `isElectron` — which UA-detects Electron even if the preload failed
 *  to expose `window.api` (in which case screen share / fullscreen silently no-op). */
export const hasNativeBridge: boolean =
  typeof window !== 'undefined' && typeof window.api !== 'undefined'

/**
 * True only for a **packaged** desktop build — the renderer loaded over `file://`.
 * In `pnpm dev` the Electron renderer is served over `http://localhost:5173`, so
 * this is false there.
 *
 * Used by `router.ts` to pick hash history (a `file://` build has no server to
 * rewrite deep links) vs browser history (web + `pnpm dev`). Auth no longer depends
 * on it — desktop sign-in runs in the main process, identically in dev and packaged.
 */
export const isPackagedDesktop: boolean =
  isElectron && typeof window !== 'undefined' && window.location.protocol === 'file:'

export const platform = {
  isElectron,
  isWeb,

  /**
   * Open a URL in the user's default browser (desktop) or a new tab (web).
   * Desktop routes through the validated `open-external` IPC handler in main;
   * web uses `window.open` with `noopener` so the new tab can't reach us.
   */
  openExternal(url: string): void {
    if (isElectron && window.api?.openExternal) {
      void window.api.openExternal(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  },

  /**
   * True only on desktop with the preload bridge loaded — where "reveal the data
   * folder" is meaningful. On web the data lives in the browser's origin storage,
   * which has no folder to open, so callers hide the affordance.
   */
  canRevealDataFolder(): boolean {
    return isElectron && Boolean(window.api?.openDataFolder)
  },

  /**
   * Reveal the app's data folder (settings, caches) in the OS file manager.
   * Desktop only — a no-op resolving to null on web.
   */
  openDataFolder(): Promise<string | null> {
    if (isElectron && window.api?.openDataFolder) return window.api.openDataFolder()
    return Promise.resolve(null)
  },

  /**
   * File-backed offline workspaces (desktop): one folder per workspace under
   * `userData/offline-workspaces/`. On web there is no filesystem — the offline
   * store falls back to localStorage (`isFileBacked()` is the branch).
   */
  offlineData: {
    isFileBacked(): boolean {
      return isElectron && Boolean(window.api?.offlineData)
    },
    /** Full read of every workspace folder — hydrates the offline store at boot. */
    load(): Promise<OfflineSnapshot | null> {
      if (isElectron && window.api?.offlineData) return window.api.offlineData.load()
      return Promise.resolve(null)
    },
    /** Write only the changed files (null = delete). Resolves false on failure. */
    save(payload: OfflineSavePayload): Promise<boolean> {
      if (isElectron && window.api?.offlineData) return window.api.offlineData.save(payload)
      return Promise.resolve(false)
    },
    /** Open a workspace's folder (or the offline root) in the OS file manager. */
    openFolder(workspaceId?: string): Promise<string | null> {
      if (isElectron && window.api?.offlineData) {
        return window.api.offlineData.openFolder(workspaceId)
      }
      return Promise.resolve(null)
    }
  },

  /**
   * List the shareable screens/windows for the desktop screen-share picker. On web
   * there's no picker (the browser shows its own on getDisplayMedia) → empty list.
   */
  getScreenSources(): Promise<ScreenSource[]> {
    if (isElectron && window.api?.getScreenSources) return window.api.getScreenSources()
    return Promise.resolve([])
  },

  /** Record which source the user picked + whether to include system audio, for the
   *  next screen-share request. */
  setScreenShareSource(id: string, audio: boolean): Promise<void> {
    if (isElectron && window.api?.setScreenShareSource) {
      return window.api.setScreenShareSource(id, audio)
    }
    return Promise.resolve()
  },

  /** Native OS-window fullscreen (desktop). On web the HTML fullscreen API already
   *  covers the display, so this is a no-op there. */
  setWindowFullScreen(flag: boolean): Promise<void> {
    if (isElectron && window.api?.setWindowFullScreen) {
      return window.api.setWindowFullScreen(flag)
    }
    return Promise.resolve()
  },

  /** Subscribe to native window fullscreen changes (desktop). No-op on web (use the
   *  DOM `fullscreenchange` event there). Returns an unsubscribe fn. */
  onWindowFullScreenChange(handler: (fullscreen: boolean) => void): () => void {
    if (isElectron && window.api?.onWindowFullScreenChange) {
      return window.api.onWindowFullScreenChange(handler)
    }
    return () => {}
  },

  /** The `zinx://…` deep link that cold-started the desktop app, if any. Null on web
   *  (a browser opens the URL as a normal route) or when there was none. */
  getInitialDeepLink(): Promise<string | null> {
    if (isElectron && window.api?.getInitialDeepLink) return window.api.getInitialDeepLink()
    return Promise.resolve(null)
  },

  /** Subscribe to deep links opened while the desktop app runs. Returns an
   *  unsubscribe fn; no-op on web. */
  onDeepLink(handler: (url: string) => void): () => void {
    if (isElectron && window.api?.onDeepLink) return window.api.onDeepLink(handler)
    return () => {}
  },

  /** Drive the window controls we draw ourselves (Windows/Linux). No-ops on web and
   *  on macOS, where the native traffic lights do this and are never redrawn. */
  windowControls: {
    minimize(): void {
      void window.api?.windowControls?.minimize()
    },
    toggleMaximize(): void {
      void window.api?.windowControls?.toggleMaximize()
    },
    close(): void {
      void window.api?.windowControls?.close()
    },
    async isMaximized(): Promise<boolean> {
      return (await window.api?.windowControls?.isMaximized()) ?? false
    },
    /** Returns an unsubscribe fn. */
    onMaximizeChange(handler: (maximized: boolean) => void): () => void {
      return window.api?.windowControls?.onMaximizeChange(handler) ?? ((): void => {})
    }
  },

  /**
   * OS notifications. Desktop goes through the preload bridge (main shows a real
   * native notification); **web falls back to the browser's Notification API**, which
   * is the same idea with a permission prompt in front of it.
   *
   * `silent` defaults true: we play our own chime in-app, and letting the OS add its
   * own on top means two sounds for one message.
   *
   * `tag` **coalesces**: a later notification with the same tag *replaces* the earlier
   * one instead of stacking a second banner. Without it, spamming a source (e.g. the
   * settings "test notification" button) piles up N banners in the OS notification
   * centre. Distinct events should use distinct tags (or none); repeated ones share a
   * tag so the newest wins.
   */
  notify(payload: {
    title: string
    body: string
    route?: string
    silent?: boolean
    tag?: string
  }): void {
    if (isElectron && window.api?.notify) {
      void window.api.notify(payload)
      return
    }
    // Web: only when the user has already granted permission. We never *prompt* from
    // here — a permission dialog that appears because a message arrived is exactly the
    // kind of interruption this feature is supposed to avoid.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(payload.title, {
          body: payload.body,
          silent: payload.silent !== false,
          // Same tag → the browser replaces the previous banner rather than adding one.
          tag: payload.tag
        })
      }
    } catch {
      /* not supported — a missing notification is not worth an exception */
    }
  },

  /**
   * May we show a desktop notification — asking for permission if we haven't yet?
   *
   * The *only* caller is the settings toggle. `notify()` deliberately never prompts (a
   * permission dialog that appears because a message arrived is exactly the interruption
   * the feature exists to avoid), but a person who just clicked "Desktop notifications" has
   * asked for the prompt, so this is where it belongs. Desktop needs none — the OS owns it.
   */
  async requestNotificationPermission(): Promise<boolean> {
    if (isElectron) return Boolean(window.api?.notify)
    try {
      if (typeof Notification === 'undefined') return false
      if (Notification.permission === 'granted') return true
      // 'denied' is the browser's setting, not ours: re-asking is not allowed and would
      // be ignored anyway.
      if (Notification.permission === 'denied') return false
      return (await Notification.requestPermission()) === 'granted'
    } catch {
      return false
    }
  },

  /** The user clicked a notification: the `route` it carried. Desktop only (main has
   *  already focused the window); a no-op on web. */
  onNotificationClick(handler: (route: string) => void): () => void {
    if (isElectron && window.api?.onNotificationClick) {
      return window.api.onNotificationClick(handler)
    }
    return () => {}
  },

  /** Unread count on the dock (macOS) / taskbar (Linux). No-op on Windows and web. */
  setBadgeCount(count: number): void {
    if (isElectron && window.api?.setBadgeCount) void window.api.setBadgeCount(count)
  },

  /**
   * Desktop "lives in the tray" settings, Discord/Slack-style (see
   * src/main/system-integration.ts). Web has no login item or tray — `supported()` is
   * false there, so the settings UI hides the whole section rather than showing dead toggles.
   */
  systemPrefs: {
    /** Only meaningful on desktop with the bridge loaded. */
    supported(): boolean {
      return isElectron && Boolean(window.api?.systemPrefs)
    },
    /** Current values, or null on web / when the bridge is absent. */
    get(): Promise<SystemPrefs | null> {
      if (isElectron && window.api?.systemPrefs) return window.api.systemPrefs.get()
      return Promise.resolve(null)
    },
    /** Register/unregister the OS login item; resolves with the value the OS reports. */
    setLaunchAtStartup(value: boolean): Promise<boolean> {
      if (isElectron && window.api?.systemPrefs) {
        return window.api.systemPrefs.setLaunchAtStartup(value)
      }
      return Promise.resolve(false)
    },
    /** Enable/disable close-to-tray; resolves with the new value. */
    setRunInBackground(value: boolean): Promise<boolean> {
      if (isElectron && window.api?.systemPrefs) {
        return window.api.systemPrefs.setRunInBackground(value)
      }
      return Promise.resolve(false)
    }
  }
}

/** Desktop launch-at-startup + run-in-background (tray) settings. */
export interface SystemPrefs {
  openAtLogin: boolean
  runInBackground: boolean
}

/** The app draws its own title bar on desktop; the web build has the browser's chrome
 *  and must not reserve a strip for one. */
export const hasCustomTitleBar = isElectron

/**
 * Who draws the minimise / maximise / close buttons — the one cross-platform decision in
 * the title bar, and it is not uniform on purpose.
 *
 *  - `'custom'` (Windows, Linux) — **we** draw them (`layout/window-controls.tsx`), so
 *    they follow the app's theme. The window is `frame: false`. This is what Discord,
 *    VS Code and Slack all do on these platforms, because the native buttons offer no
 *    real styling: Electron's `titleBarOverlay` exposes two colours and a height, and
 *    nothing else.
 *  - `'native'` (macOS) — the traffic lights, **always**. Nobody redraws those. Their
 *    colours, position, hover glyphs and Option-click behaviour are muscle memory, and a
 *    hand-drawn imitation reads as a broken app rather than a styled one. Discord, VS
 *    Code and Slack all leave them alone too. We only inset them into our taller bar.
 *  - `'none'` (web) — the browser has its own chrome.
 */
export type WindowControlsStyle = 'custom' | 'native' | 'none'

const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)

export const windowControlsStyle: WindowControlsStyle = !isElectron
  ? 'none'
  : IS_MAC_PLATFORM
    ? 'native'
    : 'custom'

/** A shareable screen or window (thumbnail + optional app icon are data URLs). */
export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
  isScreen: boolean
}

/** Raw file contents of one offline workspace folder (relPath → JSON string). */
export interface OfflineWorkspaceFiles {
  id: string
  files: Record<string, string>
}
export interface OfflineSnapshot {
  root: string | null
  workspaces: OfflineWorkspaceFiles[]
}
/** Incremental save: only changed files. A `null` file deletes it; a `null`
 *  workspace deletes its whole folder; an absent key is unchanged. */
export interface OfflineSavePayload {
  root?: string | null
  workspaces?: Record<string, Record<string, string | null> | null>
}
