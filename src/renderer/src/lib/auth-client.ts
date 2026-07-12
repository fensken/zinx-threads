/**
 * True when the WorkOS AuthKit env is present — i.e. Convex's AuthKit auto-provision
 * has written `VITE_WORKOS_CLIENT_ID` + `VITE_WORKOS_REDIRECT_URI` to `.env.local`
 * (see SETUP.md / convex.json). Gates whether the auth providers are mounted
 * (main.tsx) and therefore whether `useAppAuth`-based UI may render.
 */
export const authEnabled = Boolean(
  import.meta.env.VITE_CONVEX_URL &&
  import.meta.env.VITE_WORKOS_CLIENT_ID &&
  import.meta.env.VITE_WORKOS_REDIRECT_URI
)

/** True when a Convex backend is configured (a Convex provider is mounted in
 *  main.tsx). Gates Convex-only UI — e.g. the GIF picker's `useAction`. */
export const convexEnabled = Boolean(import.meta.env.VITE_CONVEX_URL)
