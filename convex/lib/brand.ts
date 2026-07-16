/**
 * Branding constants for the **Convex deployment** — a MIRROR of `src/shared/brand.ts`.
 *
 * The Convex bundle can only import files under `convex/`, so these are duplicated by hand.
 * **Keep them in sync with `src/shared/brand.ts`** when the product is renamed or re-skinned.
 */
export const BRAND = {
  /** Product display name — transactional email, the REST API's info, MCP server name. */
  productName: 'Zinx Threads',
  /** Brand primary as hex — for email HTML, where there are no CSS tokens. Mirrors `--primary`. */
  primaryHex: '#e11d48'
} as const

/** Personal-access / bot token prefix — greppable, like GitHub's `ghp_`. */
export const API_TOKEN_PREFIX = 'zt_'
