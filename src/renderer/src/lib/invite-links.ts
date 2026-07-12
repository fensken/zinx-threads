/** Base origin for shareable invite links. On web this is the current origin; on a
 *  packaged desktop (`file://`) build there's no shareable origin, so set `VITE_APP_URL`
 *  to the deployed web app. Falls back to the dev web server. */
function base(): string {
  const configured = import.meta.env.VITE_APP_URL as string | undefined
  if (configured) return configured.replace(/\/+$/, '')
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return window.location.origin
  }
  return 'http://localhost:5173'
}

/** Shareable link that joins a workspace (`/invite/<code>`). */
export function workspaceInviteUrl(code: string): string {
  return `${base()}/invite/${encodeURIComponent(code)}`
}

/** Extract an invite code from user input — accepts either a bare code or a full
 *  `/invite/<code>` link (any origin). This lets the manual "join by code" box on
 *  `/workspaces` take whatever the inviter pasted, since the invite dialog hands out
 *  a link, not a bare code. */
export function parseInviteCode(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/\/invite\/([^/?#\s]+)/)
  if (!match) return trimmed
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/** Shareable link that accepts a channel share (`/connect/<token>`). */
export function channelConnectUrl(token: string): string {
  return `${base()}/connect/${encodeURIComponent(token)}`
}

/** A `zinx://` deep link for an in-app route path (`/invite/abc` → `zinx://invite/abc`).
 *  Powers the web "Open in the desktop app" affordance — the desktop app registers as
 *  the OS handler for the `zinx://` scheme (see src/main/index.ts). */
export function appDeepLinkUrl(routePath: string): string {
  return `zinx://${routePath.replace(/^\/+/, '')}`
}
