import { ArrowSquareOut } from '@phosphor-icons/react'
import { isWeb } from '@renderer/lib/platform'
import { appDeepLinkUrl } from '@renderer/lib/invite-links'
import { Button } from '@renderer/components/ui/button'

/** "Open in the desktop app" — the web half of deep linking. Navigates the browser to
 *  the `zinx://` scheme, which the OS routes to the installed Zinx Threads app (if
 *  present). Renders nothing inside the desktop app itself (it IS the app) — so a
 *  web-only affordance, and the web page's own flow always stays as the fallback when
 *  the app isn't installed. `path` is an in-app route, e.g. `/invite/<code>`. */
export function OpenInApp({ path }: { path: string }): React.JSX.Element | null {
  if (!isWeb) return null
  return (
    <Button
      variant="outline"
      className="gap-2"
      onClick={() => {
        window.location.href = appDeepLinkUrl(path)
      }}
    >
      <ArrowSquareOut className="size-4" />
      Open in the desktop app
    </Button>
  )
}
