import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// Custom APIs for renderer. Keep this narrow + typed (see index.d.ts) — it is the
// ONLY surface the web/desktop `platform` layer (renderer/src/lib/platform.ts)
// bridges to. Every method is validated + handled in the main process.
const api = {
  /** Open an external URL in the OS default browser (validated in main). */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),

  /** Reveal the app's data folder (settings, caches) in the OS file manager.
   *  Resolves with the path that was opened. */
  openDataFolder: (): Promise<string> => ipcRenderer.invoke('open-data-folder'),

  /** File-backed offline workspaces — one folder per workspace under
   *  `userData/offline-workspaces/` (see src/main/local-data.ts). The renderer
   *  hydrates from `load()` once, then syncs changed files via `save()`. */
  offlineData: {
    load: (): Promise<OfflineSnapshot> => ipcRenderer.invoke('offline-data:load'),
    save: (payload: OfflineSavePayload): Promise<boolean> =>
      ipcRenderer.invoke('offline-data:save', payload),
    /** Open a workspace's folder (or the offline root when no id) in the OS file
     *  manager. Resolves with the path, or null on failure. */
    openFolder: (workspaceId?: string): Promise<string | null> =>
      ipcRenderer.invoke('offline-data:open-folder', workspaceId)
  },

  /** WorkOS sign-in — handled entirely in the main process (PKCE + encrypted token
   *  vault + in-app login window). The renderer holds no tokens; it drives the flow
   *  and reads state through this surface. See src/main/auth.ts + lib/desktop-auth.ts. */
  auth: {
    /** Hand main the client id (from the renderer's `VITE_WORKOS_CLIENT_ID`) before
     *  any token fetch, so main needs no env plumbing. */
    configure: (clientId: string): Promise<void> => ipcRenderer.invoke('auth:configure', clientId),
    /** Current session state (reads the encrypted vault). */
    getState: (): Promise<AuthState> => ipcRenderer.invoke('auth:get-state'),
    /** A valid access token for Convex (refreshed when near expiry, or when forced). */
    getToken: (force: boolean): Promise<string | null> =>
      ipcRenderer.invoke('auth:get-token', force),
    /** Open the in-app WorkOS login window; resolves with the resulting state. */
    signIn: (): Promise<AuthState> => ipcRenderer.invoke('auth:sign-in'),
    /** Clear the session (vault + memory). */
    signOut: (): Promise<void> => ipcRenderer.invoke('auth:sign-out'),
    /** Subscribe to session changes (sign-in / refresh failure / sign-out). Returns an
     *  unsubscribe fn; only the state object crosses the bridge, not the event. */
    onChanged: (handler: (state: AuthState) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, state: AuthState): void => handler(state)
      ipcRenderer.on('auth:changed', listener)
      return () => ipcRenderer.removeListener('auth:changed', listener)
    }
  },

  /** Screen-share picker: list the shareable screens/windows (with thumbnails). */
  getScreenSources: (): Promise<ScreenSource[]> => ipcRenderer.invoke('get-screen-sources'),
  /** Tell main which source the user picked + whether to include system audio;
   *  used by the next screen-share request. */
  setScreenShareSource: (id: string, audio: boolean): Promise<void> =>
    ipcRenderer.invoke('set-screen-share-source', id, audio),

  /** Put the OS window into (or out of) native fullscreen (title bar + taskbar
   *  gone) — the call stage's true-fullscreen mode. */
  setWindowFullScreen: (flag: boolean): Promise<void> =>
    ipcRenderer.invoke('set-window-fullscreen', flag),

  /** Subscribe to native window fullscreen state changes (incl. F11 / menu, not
   *  just our button). Returns an unsubscribe fn. Only the boolean crosses. */
  onWindowFullScreenChange: (handler: (fullscreen: boolean) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, fullscreen: boolean): void => handler(fullscreen)
    ipcRenderer.on('window-fullscreen-changed', listener)
    return () => ipcRenderer.removeListener('window-fullscreen-changed', listener)
  },

  /** The `zinx://…` deep link that cold-started the app, if any (consumed once). The
   *  renderer pulls this on mount, since a launch URL arrives before it can subscribe. */
  getInitialDeepLink: (): Promise<string | null> => ipcRenderer.invoke('deep-link:get-initial'),

  /** Subscribe to deep links opened while the app is running. Returns an unsubscribe
   *  fn; only the URL string crosses the bridge. */
  onDeepLink: (handler: (url: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, url: string): void => handler(url)
    ipcRenderer.on('deep-link', listener)
    return () => ipcRenderer.removeListener('deep-link', listener)
  },

  /** The window controls we draw ourselves (Windows/Linux; macOS keeps its native
   *  traffic lights). Only the OS can actually perform these, so each is a plain
   *  argument-free command — nothing to validate in main. */
  windowControls: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    /** Returns the maximised state AFTER the toggle. */
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    /** The window is also maximised by double-click, Win+Up, snapping and the WM — so
     *  the button's glyph has to follow main, not just its own clicks. */
    onMaximizeChange: (handler: (maximized: boolean) => void): (() => void) => {
      const listener = (_e: unknown, maximized: boolean): void => handler(maximized)
      ipcRenderer.on('window-maximize-changed', listener)
      return () => ipcRenderer.removeListener('window-maximize-changed', listener)
    }
  },

  /** Show an OS notification. The renderer decides *whether* (it knows what arrived
   *  and whether the window was focused); main only shows it. `route` is opaque to
   *  main and handed straight back on click. */
  notify: (payload: {
    title: string
    body: string
    route?: string
    silent?: boolean
    tag?: string
  }): Promise<boolean> => ipcRenderer.invoke('notify', payload),

  /** The user clicked a notification — main has already focused the window; this is
   *  the `route` it carried, so the renderer can navigate. */
  onNotificationClick: (handler: (route: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, route: string): void => handler(route)
    ipcRenderer.on('notification:click', listener)
    return () => ipcRenderer.removeListener('notification:click', listener)
  },

  /** Unread count on the dock (macOS) / taskbar (Linux). A no-op on Windows. */
  setBadgeCount: (count: number): Promise<void> => ipcRenderer.invoke('set-badge-count', count),

  /** In-app auto-update state for the title-bar "Update available" badge (see
   *  src/main/updater.ts). `getState` on mount, then subscribe via `onStateChange`;
   *  `install` restarts into the staged update (Windows/Linux). */
  updates: {
    getState: (): Promise<UpdateState> => ipcRenderer.invoke('update:get-state'),
    install: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
    onStateChange: (handler: (state: UpdateState) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, state: UpdateState): void => handler(state)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.removeListener('update:state', listener)
    }
  },

  /** Desktop "lives in the tray" settings, Discord/Slack-style (see src/main/system-integration.ts).
   *  `launchAtStartup` registers a login item with the OS; `runInBackground` makes closing the
   *  window hide it to a tray icon and keep the app running until the user quits. */
  systemPrefs: {
    /** The current values — reads the OS login item + the persisted run-in-background flag. */
    get: (): Promise<SystemPrefs> => ipcRenderer.invoke('system:get-prefs'),
    /** Register/unregister the OS login item; resolves with the value the OS reports back. */
    setLaunchAtStartup: (value: boolean): Promise<boolean> =>
      ipcRenderer.invoke('system:set-open-at-login', value),
    /** Enable/disable close-to-tray (creates/removes the tray icon); resolves with the new value. */
    setRunInBackground: (value: boolean): Promise<boolean> =>
      ipcRenderer.invoke('system:set-run-in-background', value)
  }
}

/** Desktop launch-at-startup + run-in-background (tray) settings. */
export interface SystemPrefs {
  /** The app is registered to open when the user logs in. */
  openAtLogin: boolean
  /** Closing the window hides it to the tray instead of quitting. */
  runInBackground: boolean
}

/** In-app auto-update state (title-bar badge). */
export interface UpdateState {
  available: boolean
  downloaded: boolean
  version: string | null
  url: string | null
}

/** A shareable screen or window (thumbnail is a data URL). */
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

/** The signed-in user (camelCase, mirrors authkit-react's `user`) + whether a session
 *  exists — mapped in main from the WorkOS response. */
export interface AuthUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}
export interface AuthState {
  isAuthenticated: boolean
  user: AuthUser | null
}

// A minimal Electron marker — the renderer's `platform` layer only feature-detects
// Electron via `typeof window.electron !== 'undefined'`, it never uses its members.
// We deliberately do NOT expose `@electron-toolkit/preload`'s `electronAPI`: that
// import can fail to load under `sandbox: true` (which we require), and if the
// preload throws, NOTHING gets exposed — leaving `window.electron`/`window.api`
// undefined and every native call (screen share, fullscreen, auth callback) a silent
// no-op. This module now uses ONLY `electron`'s `contextBridge` + `ipcRenderer`,
// which are always available in a sandboxed preload.
const electronMarker = {
  process: { platform: process.platform, versions: process.versions }
}

// Expose the bridge. `contextIsolation` is on, so contextBridge is the path.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronMarker)
    contextBridge.exposeInMainWorld('api', api)
    console.log('[preload] bridge exposed (window.electron + window.api)')
  } catch (error) {
    console.error('[preload] failed to expose bridge:', error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronMarker
  // @ts-ignore (define in dts)
  window.api = api
}
