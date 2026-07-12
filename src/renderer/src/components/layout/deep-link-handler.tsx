import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { platform } from '@renderer/lib/platform'

/** Turn a `zinx://…` deep link into an in-app route path.
 *  `zinx://invite/abc` → `/invite/abc`; `zinx://w/acme/general` → `/w/acme/general`. */
function deepLinkToPath(url: string): string | null {
  const prefix = 'zinx://'
  if (!url.startsWith(prefix)) return null
  const rest = url.slice(prefix.length).replace(/^\/+/, '')
  return `/${rest}`
}

/** Routes `zinx://` deep links (invite / channel-connect / channel URLs) into the app
 *  — the desktop half of "Open in app". Handles both the cold-start link (pulled once
 *  from the main process) and links opened while the app is already running. Web is a
 *  no-op: a browser opens those URLs as ordinary routes and has no `zinx://` handler.
 *  Renders nothing. Mounted once in `__root`. */
export function DeepLinkHandler(): null {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const go = (url: string): void => {
      const path = deepLinkToPath(url)
      // `history.push` navigates by raw path string (the target is dynamic, so the
      // typed `router.navigate({ to })` can't be used). The invite/connect routes
      // handle their own auth gate, so a signed-out deep link lands correctly after
      // sign-in (the URL persists through the in-process login window).
      if (path) router.history.push(path)
    }

    // Cold start: the link that launched the app (consumed once in main).
    void platform.getInitialDeepLink().then((url) => {
      if (!cancelled && url) go(url)
    })

    // While running: links opened from the browser / email / another app.
    const unsubscribe = platform.onDeepLink(go)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [router])

  return null
}
