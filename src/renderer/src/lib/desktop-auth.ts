/**
 * Renderer-side bridge to the MAIN-process WorkOS auth (src/main/auth.ts) — a tiny
 * external store so the whole app reads one live auth state over a single IPC
 * subscription. The renderer holds NO tokens: sign-in opens main's in-app login
 * window, and Convex gets its access token via `getToken` (main refreshes as needed).
 *
 * On web `window.api` is absent, so these are inert — the web build authenticates
 * with authkit-react instead (see use-app-auth.ts).
 */
import { useSyncExternalStore } from 'react'
import type { AuthUser } from './use-app-auth'

export interface DesktopAuthState {
  isLoading: boolean
  isAuthenticated: boolean
  user: AuthUser | null
}

let current: DesktopAuthState = { isLoading: true, isAuthenticated: false, user: null }
const listeners = new Set<() => void>()

function set(next: DesktopAuthState): void {
  current = next
  for (const listener of listeners) listener()
}

let initialized = false

/** Configure main with the client id and load the persisted session. Call once at boot
 *  (main.tsx) BEFORE Convex mounts, so a token fetch never races an unconfigured main. */
export function initDesktopAuth(clientId: string): void {
  if (initialized) return
  initialized = true
  const bridge = window.api?.auth
  if (!bridge) {
    set({ isLoading: false, isAuthenticated: false, user: null })
    return
  }
  void bridge.configure(clientId)
  void bridge.getState().then((state) => set({ isLoading: false, ...state }))
  bridge.onChanged((state) => set({ isLoading: false, ...state }))
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

function getSnapshot(): DesktopAuthState {
  return current
}

/** Subscribe a component to the live desktop auth state. */
export function useDesktopAuthState(): DesktopAuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const desktopAuth = {
  /** Open main's in-app WorkOS login window; `onChanged` also updates on success. */
  signIn(): void {
    void window.api?.auth?.signIn().then((state) => set({ isLoading: false, ...state }))
  },
  signOut(): void {
    void window.api?.auth
      ?.signOut()
      .then(() => set({ isLoading: false, isAuthenticated: false, user: null }))
  },
  /** A valid access token for Convex (main refreshes near expiry or when forced). */
  getToken(force: boolean): Promise<string | null> {
    return window.api?.auth?.getToken(force) ?? Promise.resolve(null)
  }
}
