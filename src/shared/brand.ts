/**
 * **Branding + app-level constants — the single source of truth.**
 *
 * Values that change together when the product is renamed or re-skinned live here, so there's one
 * place to edit. Zero dependencies (no Node, no DOM), so it's safe in every process and stays
 * web-portable. Imported by:
 *   • the **renderer** via the `@shared/brand` alias, and
 *   • the Electron **main / preload** via a relative import (`../shared/brand`).
 *
 * ⚠ Three surfaces CANNOT import this (separate bundles / not TypeScript) — when you change a
 * value here, mirror it in each:
 *   • **`convex/lib/brand.ts`** — the Convex deployment bundles only `convex/` (product name,
 *     brand colour, token prefix).
 *   • **`electron-builder.yml`** — `appId`, `productName`, `win.publisherName`, the `zinx` scheme.
 *   • **`src/renderer/index.html`** — `<title>`, `<meta name="description">`, `theme-color`.
 *   • **`src/renderer/src/assets/globals.css`** — the real `--primary` (this file's `primaryHex`
 *     is only a mirror for non-CSS contexts).
 */
export const BRAND = {
  /** Product display name — title bar, sign-in, onboarding, settings, emails. */
  productName: 'Zinx Threads',
  /** Company / publisher (shorter than the product). Shown as the Windows publisher only once the
   *  app is code-signed — the cert's Organization, set under electron-builder `win.signtoolOptions`
   *  (or Azure Trusted Signing), not a plain config field. */
  company: 'Zinx',
  /** One-line description (store listing, `index.html` meta). */
  description: 'Zinx Threads — team chat, docs, and boards in one place.',
  /** Reverse-DNS id — electron `appId` + Windows AppUserModelId. Mirror in electron-builder.yml. */
  appId: 'com.zinxthreads.app',
  /** Brand primary as hex — mirrors CSS `--primary`, for the few non-CSS spots (`theme-color`,
   *  transactional email HTML). The CSS token is the real source; this must match it. */
  primaryHex: '#e11d48',
  /** Primary domain — email addresses, marketing links. Currently `zinx.app` (the Resend-verified
   *  sending domain); the intended real domain is **`zinxthreads.com`** (to be purchased). When it
   *  lands, change `domain` + `supportEmail` here, the electron-builder deb `maintainer`, and the
   *  Resend sending domain. NB: `appId` above is a reverse-DNS *identifier*, not a real domain —
   *  and it already sits in the `com.zinxthreads` namespace, so it's forward-compatible and does
   *  NOT change. */
  domain: 'zinx.app',
  /** Where users reach support (electron-builder deb `maintainer`, footer links). */
  supportEmail: 'support@zinx.app'
} as const

/** The custom URL scheme for deep links (`zinx://…`), registered as the OS handler. Mirror the
 *  scheme in electron-builder.yml `protocols`. */
export const DEEP_LINK_SCHEME = 'zinx'

/** Desktop OAuth loopback redirect (RFC 8252 native-app pattern). NOT a served endpoint — main
 *  intercepts the navigation to it (see `src/main/auth.ts`). Register this EXACT URI in WorkOS.
 *  It stays `127.0.0.1` in production too — loopback is the permanent native-app convention. */
export const DESKTOP_LOOPBACK_PORT = 9876
export const DESKTOP_REDIRECT_URI = `http://127.0.0.1:${DESKTOP_LOOPBACK_PORT}/callback`

/** Custom title-bar height in px. The native window-controls overlay is sized in px and can't
 *  follow the rem-based UI-scale setting, so the bar is the one part deliberately not rem-scaled.
 *  The renderer expresses the same height as Tailwind `h-11` (= 44px) — keep them in step. */
export const TITLE_BAR_HEIGHT = 44
