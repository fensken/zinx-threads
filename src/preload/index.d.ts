/** A minimal Electron marker (the renderer only feature-detects its presence). */
export interface ElectronMarker {
  process: { platform: string; versions: NodeJS.ProcessVersions }
}

/** The narrow, typed bridge exposed by the preload (see preload/index.ts).
 *  In a browser build these globals are absent — the renderer must reach them
 *  only through `renderer/src/lib/platform.ts`, which feature-detects + falls
 *  back so the same code runs as the Electron app and as a plain web app. */
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
/** File-backed offline workspaces (one folder per workspace). */
export interface OfflineDataBridge {
  load: () => Promise<OfflineSnapshot>
  save: (payload: OfflineSavePayload) => Promise<boolean>
  openFolder: (workspaceId?: string) => Promise<string | null>
}

/** The signed-in user (camelCase, mirrors authkit-react's `user`). */
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

/** Main-process WorkOS auth (PKCE + token vault + in-app login window). The renderer
 *  holds no tokens — it drives sign-in and reads state through this. */
export interface AuthBridge {
  configure: (clientId: string) => Promise<void>
  getState: () => Promise<AuthState>
  getToken: (force: boolean) => Promise<string | null>
  signIn: () => Promise<AuthState>
  signOut: () => Promise<void>
  onChanged: (handler: (state: AuthState) => void) => () => void
}

export interface ZinxApi {
  openExternal: (url: string) => Promise<void>
  /** Reveal the app's data folder (settings, caches) in the OS file manager. */
  openDataFolder: () => Promise<string>
  /** File-backed offline workspaces — one folder per workspace on disk. */
  offlineData: OfflineDataBridge
  /** Desktop WorkOS auth surface. Absent in the web build (reached via lib/desktop-auth.ts). */
  auth: AuthBridge
  /** List shareable screens/windows for the screen-share picker (desktop only). */
  getScreenSources: () => Promise<ScreenSource[]>
  /** Record the source the user picked + whether to include audio, for the next
   *  getDisplayMedia request. */
  setScreenShareSource: (id: string, audio: boolean) => Promise<void>
  /** Put the OS window into (or out of) native fullscreen (title bar + taskbar
   *  gone) — the call stage's true-fullscreen mode. */
  setWindowFullScreen: (flag: boolean) => Promise<void>
  /** Subscribe to native window fullscreen state changes. Returns an unsubscribe fn. */
  onWindowFullScreenChange: (handler: (fullscreen: boolean) => void) => () => void
  /** The `zinx://…` deep link that cold-started the app, if any (consumed once). */
  getInitialDeepLink: () => Promise<string | null>
  /** Subscribe to deep links opened while running. Returns an unsubscribe fn. */
  onDeepLink: (handler: (url: string) => void) => () => void
  /** Repaint the native window buttons to match the theme (Windows/Linux). */
  windowControls: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizeChange: (handler: (maximized: boolean) => void) => () => void
  }
  /** Show an OS notification. `route` is handed back on click. */
  notify: (payload: {
    title: string
    body: string
    route?: string
    silent?: boolean
    tag?: string
  }) => Promise<boolean>
  /** The user clicked a notification: its `route`. Returns an unsubscribe fn. */
  onNotificationClick: (handler: (route: string) => void) => () => void
  /** Unread badge on the dock/taskbar. */
  setBadgeCount: (count: number) => Promise<void>
  /** Desktop launch-at-startup + run-in-background (tray) settings. */
  systemPrefs: SystemPrefsBridge
  /** In-app auto-update state + install trigger (title-bar badge). */
  updates: UpdatesBridge
}

/** In-app auto-update state (title-bar badge). */
export interface UpdateState {
  available: boolean
  downloaded: boolean
  version: string | null
  url: string | null
}
export interface UpdatesBridge {
  getState: () => Promise<UpdateState>
  install: () => Promise<boolean>
  onStateChange: (handler: (state: UpdateState) => void) => () => void
}

/** Desktop launch-at-startup + run-in-background (tray) settings. */
export interface SystemPrefs {
  openAtLogin: boolean
  runInBackground: boolean
}
export interface SystemPrefsBridge {
  get: () => Promise<SystemPrefs>
  setLaunchAtStartup: (value: boolean) => Promise<boolean>
  setRunInBackground: (value: boolean) => Promise<boolean>
}

declare global {
  interface Window {
    electron?: ElectronMarker
    api?: ZinxApi
  }
}
