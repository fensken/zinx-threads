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

/** True when running inside the Electron renderer (preload bridge present). */
export const isElectron: boolean =
  typeof window !== 'undefined' && typeof window.electron !== 'undefined'

/** True when running in a normal browser (web build). */
export const isWeb = !isElectron

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
  }
}
