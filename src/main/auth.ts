/**
 * WorkOS AuthKit sign-in for the desktop app — run **entirely in the main process**.
 *
 * This is the shape the official `workos/electron-authkit-example` uses, and it's why
 * it's reliable where a renderer-side SPA flow isn't:
 *
 *   • The renderer holds NO tokens. It calls `window.api.auth.*` over IPC; main owns
 *     the PKCE verifier, the code exchange, the refresh loop, and the token vault.
 *   • The PKCE `code_verifier` never leaves main memory, so navigating the login
 *     window to WorkOS and back can't lose it (the bug the renderer flow fought).
 *   • Tokens persist in an **OS-keychain-encrypted file** (`safeStorage`), not renderer
 *     `localStorage` — so a restart re-authenticates silently and an XSS can't read them.
 *   • Login happens **in-app** (a dedicated `BrowserWindow`, Discord-style) — we
 *     intercept its navigation to the registered redirect URI, so no loopback HTTP
 *     server and no `zinx://` protocol registration are needed.
 *
 * Public client (PKCE, no client secret — the binary can be decompiled). The client id
 * is supplied by the renderer via `auth:configure` (it already has `VITE_WORKOS_CLIENT_ID`),
 * so no main-process env plumbing is required.
 */
import { BrowserWindow, app, ipcMain, safeStorage } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WORKOS_API_BASE = 'https://api.workos.com'
// Registered in the WorkOS dashboard. Nothing listens here — the login window's
// navigation to it is intercepted (will-redirect) and the code is read off the URL.
const REDIRECT_URI = 'http://127.0.0.1:9876/callback'

/** The camelCase user shape the renderer expects (mirrors `authkit-react`'s `user`),
 *  mapped from the snake_case WorkOS API response. */
export interface AuthUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}

interface Session {
  accessToken: string
  refreshToken: string
  user: AuthUser
}

interface AuthState {
  isAuthenticated: boolean
  user: AuthUser | null
}

let clientId = ''
let session: Session | null = null
let loaded = false
let getMainWindow: () => BrowserWindow | null = () => null

// ── Encrypted token vault (userData/auth.bin) ───────────────────────────────────
// safeStorage encrypts with the OS keychain (Windows Credential Manager / macOS
// Keychain / libsecret). Where it's unavailable (a headless Linux box) we fall back
// to plaintext — functional, a documented downgrade, same as the WorkOS example.

function vaultPath(): string {
  return join(app.getPath('userData'), 'auth.bin')
}

function loadSession(): void {
  loaded = true
  try {
    const path = vaultPath()
    if (!existsSync(path)) return
    const raw = readFileSync(path)
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
    const parsed = JSON.parse(json) as Session
    if (parsed?.accessToken && parsed?.refreshToken) session = parsed
  } catch (error) {
    console.error('[auth] failed to load vault:', error)
    session = null
  }
}

function ensureLoaded(): void {
  if (!loaded) loadSession()
}

function persist(): void {
  try {
    const path = vaultPath()
    if (!session) {
      if (existsSync(path)) rmSync(path)
      return
    }
    const json = JSON.stringify(session)
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)
      : Buffer.from(json, 'utf8')
    writeFileSync(path, data)
  } catch (error) {
    console.error('[auth] failed to persist vault:', error)
  }
}

// ── PKCE + JWT helpers ──────────────────────────────────────────────────────────

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** The access token's `exp` in ms (0 if it can't be read — treated as expired). We only
 *  decode it here to decide when to refresh; Convex verifies its signature server-side. */
function tokenExpiryMs(token: string): number {
  try {
    const payload = token.split('.')[1]
    if (!payload) return 0
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    )
    const claims = JSON.parse(json) as { exp?: number }
    return typeof claims.exp === 'number' ? claims.exp * 1000 : 0
  } catch {
    return 0
  }
}

function mapUser(raw: unknown): AuthUser {
  const user = (raw ?? {}) as Record<string, unknown>
  const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  return {
    id: asString(user.id) ?? '',
    email: asString(user.email) ?? '',
    firstName: asString(user.first_name),
    lastName: asString(user.last_name),
    profilePictureUrl: asString(user.profile_picture_url)
  }
}

function state(): AuthState {
  ensureLoaded()
  return { isAuthenticated: Boolean(session), user: session?.user ?? null }
}

function broadcast(): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) window.webContents.send('auth:changed', state())
}

// ── Token exchange + refresh (WorkOS public authenticate endpoint) ──────────────

/** POST the authenticate endpoint and adopt the returned session. Returns false (and
 *  logs) on any failure — the raw error never reaches the UI. */
async function authenticate(body: Record<string, string>): Promise<boolean> {
  if (!clientId) {
    console.error('[auth] no client id configured')
    return false
  }
  try {
    const response = await fetch(`${WORKOS_API_BASE}/user_management/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, ...body })
    })
    if (!response.ok) {
      console.error('[auth] authenticate failed:', response.status)
      return false
    }
    const data = (await response.json()) as {
      access_token?: unknown
      refresh_token?: unknown
      user?: unknown
    }
    if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
      console.error('[auth] authenticate returned no tokens')
      return false
    }
    session = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: mapUser(data.user)
    }
    persist()
    return true
  } catch (error) {
    console.error('[auth] authenticate error:', error)
    return false
  }
}

/** Refresh the access token. WorkOS rotates the refresh token on every use, so we
 *  persist the replacement; a failed refresh means the session is dead → clear it. */
async function refresh(): Promise<boolean> {
  ensureLoaded()
  if (!session) return false
  const ok = await authenticate({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken
  })
  if (!ok) {
    session = null
    persist()
  }
  return ok
}

/** Return a valid access token, refreshing when it's within a minute of expiry (or when
 *  Convex forces it). Null when there's no session or the refresh failed. */
export async function getToken(forceRefresh: boolean): Promise<string | null> {
  ensureLoaded()
  if (!session) return null
  const expiry = tokenExpiryMs(session.accessToken)
  if (forceRefresh || expiry === 0 || Date.now() > expiry - 60_000) {
    const ok = await refresh()
    if (!ok) {
      broadcast()
      return null
    }
  }
  return session?.accessToken ?? null
}

// ── In-app login window ─────────────────────────────────────────────────────────

let authWindow: BrowserWindow | null = null

function buildAuthorizeUrl(challenge: string, csrfState: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    provider: 'authkit',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: csrfState
  })
  return `${WORKOS_API_BASE}/user_management/authorize?${params.toString()}`
}

/** Open the WorkOS hosted login in a dedicated window and resolve once it completes
 *  (or the user closes it). We intercept the window's navigation to `REDIRECT_URI`,
 *  read the `?code`, and exchange it — so the redirect target is never actually loaded. */
async function signIn(parent: BrowserWindow | null): Promise<AuthState> {
  if (!clientId) {
    console.error('[auth] cannot sign in: no client id configured')
    return state()
  }
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus()
    return state()
  }

  const { verifier, challenge } = makePkce()
  const csrfState = base64url(randomBytes(16))

  return new Promise<AuthState>((resolve) => {
    const window = new BrowserWindow({
      width: 480,
      height: 720,
      parent: parent ?? undefined,
      modal: Boolean(parent),
      autoHideMenuBar: true,
      title: 'Sign in to Zinx Threads',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Its own persistent session so WorkOS SSO cookies survive between logins,
        // isolated from the app's session.
        partition: 'persist:workos-auth'
      }
    })
    authWindow = window

    let settled = false
    const finish = async (code: string | null): Promise<void> => {
      if (settled) return
      settled = true
      if (
        code &&
        (await authenticate({ grant_type: 'authorization_code', code, code_verifier: verifier }))
      ) {
        broadcast()
      }
      if (!window.isDestroyed()) window.destroy()
      authWindow = null
      resolve(state())
    }

    const onNavigate = (details: { preventDefault: () => void; url: string }): void => {
      if (!details.url.startsWith(REDIRECT_URI)) return
      details.preventDefault() // never actually load the (dead) loopback URL
      try {
        const url = new URL(details.url)
        if (url.searchParams.get('state') !== csrfState) {
          console.error('[auth] state mismatch — ignoring callback')
          void finish(null)
          return
        }
        void finish(url.searchParams.get('code'))
      } catch {
        void finish(null)
      }
    }

    window.webContents.on('will-redirect', onNavigate)
    window.webContents.on('will-navigate', onNavigate)
    window.on('closed', () => {
      authWindow = null
      if (!settled) {
        settled = true
        resolve(state())
      }
    })

    void window.loadURL(buildAuthorizeUrl(challenge, csrfState))
  })
}

function signOut(): void {
  session = null
  persist()
  broadcast()
}

/** Wire the auth IPC surface. `mainWindowGetter` lets `broadcast()` reach the current
 *  window (it can be recreated on macOS). */
export function registerAuthIpc(mainWindowGetter: () => BrowserWindow | null): void {
  getMainWindow = mainWindowGetter

  // The renderer passes its `VITE_WORKOS_CLIENT_ID` here (called before any token
  // fetch), so main doesn't need its own env plumbing. String-validated.
  ipcMain.handle('auth:configure', (_event, id: unknown) => {
    if (typeof id === 'string' && id) clientId = id
  })
  ipcMain.handle('auth:get-state', () => state())
  ipcMain.handle('auth:get-token', (_event, force: unknown) => getToken(force === true))
  ipcMain.handle('auth:sign-in', () => signIn(getMainWindow()))
  ipcMain.handle('auth:sign-out', () => {
    signOut()
  })
}
