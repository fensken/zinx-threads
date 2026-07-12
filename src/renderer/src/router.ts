import { createRouter, createHashHistory, createBrowserHistory } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { isPackagedDesktop } from './lib/platform'

// ONLY a packaged desktop build (served over `file://`, no server to rewrite deep
// links) needs hash history. `pnpm dev` runs the Electron renderer over
// `http://localhost:5173` — a real origin with Vite's SPA fallback — so it uses
// browser history exactly like the web build. This also matters for auth: the
// WorkOS redirect lands on the *path* `/callback`, which only browser history
// routes; under hash history the callback route never matched, which is why
// dev sign-in didn't redirect. (Gated on `isPackagedDesktop`, same as auth-actions.)
export const router = createRouter({
  routeTree,
  history: isPackagedDesktop ? createHashHistory() : createBrowserHistory(),
  defaultPreload: 'intent',
  scrollRestoration: true
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
