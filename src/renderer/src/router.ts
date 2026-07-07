import { createRouter, createHashHistory, createBrowserHistory } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { isElectron } from './lib/platform'

// Desktop is served over file:// in production (no server to rewrite deep links)
// → hash history. The web build is served by a host with SPA fallback → clean
// browser-history URLs. Same renderer, history picked per target at load.
export const router = createRouter({
  routeTree,
  history: isElectron ? createHashHistory() : createBrowserHistory(),
  defaultPreload: 'intent',
  scrollRestoration: true
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
