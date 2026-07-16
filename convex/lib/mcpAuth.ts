import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/**
 * MCP authorization. Two credentials reach the `/mcp` endpoint, and both resolve to a user:
 *
 *  1. **A personal access token** (`zt_…`) — for the MCP Inspector, scripts, or any client
 *     that takes a bearer token. Verified against its stored hash.
 *  2. **A WorkOS AuthKit OAuth 2.1 access token** (a JWT) — the real connector flow. Claude /
 *     ChatGPT discover our authorization server, register themselves (DCR/CIMD), send the user
 *     through a WorkOS login + consent, and present the resulting token. We are the OAuth
 *     **resource server**: WorkOS does the whole dance; we only verify the token it issued.
 *
 * Either way the request ends up acting AS a single user, so every tool downstream inherits
 * that user's exact permissions — the same guarantee the PAT path already gave.
 */

/** This resource server's identifier — the value WorkOS mints tokens FOR (the `aud`), and the
 *  `resource` in our Protected Resource Metadata. Convex injects `CONVEX_SITE_URL` into the
 *  deployment at runtime (the `.site` domain HTTP actions are served from). */
export function mcpResource(): string {
  const site = (process.env.CONVEX_SITE_URL ?? '').replace(/\/$/, '')
  return `${site}/mcp`
}

/** The WorkOS **AuthKit domain** — the OAuth authorization server (its metadata lives at
 *  `${domain}/.well-known/oauth-authorization-server`, JWKS at `${domain}/oauth2/jwks`). Set
 *  as a Convex env var; empty means OAuth isn't configured yet and only PATs work. */
export function authkitDomain(): string {
  return (process.env.AUTHKIT_DOMAIN ?? '').replace(/\/$/, '')
}

/** RFC 9728 Protected Resource Metadata — how an MCP client discovers WHERE to get a token.
 *  Served at `/.well-known/oauth-protected-resource`; the 401 below points clients to it. */
export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: mcpResource(),
    authorization_servers: [authkitDomain()],
    bearer_methods_supported: ['header']
  }
}

/** The `WWW-Authenticate` value on a 401 — RFC 9728 says point the client at the metadata
 *  document so it can start the OAuth flow on its own. */
export function wwwAuthenticate(): string {
  const site = (process.env.CONVEX_SITE_URL ?? '').replace(/\/$/, '')
  const metadata = `${site}/.well-known/oauth-protected-resource`
  return `Bearer error="unauthorized", error_description="Authorization needed", resource_metadata="${metadata}"`
}

// The remote JWKS set is cached per isolate (jose caches the keys + refreshes on rotation).
// Rebuilt only if the domain env changes between invocations, which it never does.
let jwks: JWTVerifyGetKey | null = null
let jwksDomain = ''
function jwksFor(domain: string): JWTVerifyGetKey {
  if (!jwks || jwksDomain !== domain) {
    jwks = createRemoteJWKSet(new URL(`${domain}/oauth2/jwks`))
    jwksDomain = domain
  }
  return jwks
}

/** Resolve the bearer credential on a request to a user id, or null. */
export async function resolveMcpUser(
  ctx: ActionCtx,
  request: Request
): Promise<Id<'users'> | null> {
  const header = request.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null

  // Personal access token — hashed lookup.
  if (token.startsWith('zt_')) {
    const hashedToken = await sha256Hex(token)
    return ctx.runQuery(internal.mcp.userIdForToken, { hashedToken })
  }

  // Otherwise a WorkOS AuthKit JWT. No domain configured → OAuth isn't set up; reject.
  const domain = authkitDomain()
  if (!domain) return null

  let subject: string
  try {
    const { payload } = await jwtVerify(token, jwksFor(domain), {
      issuer: domain,
      audience: mcpResource()
    })
    if (typeof payload.sub !== 'string') return null
    subject = payload.sub
  } catch {
    // Bad signature, wrong issuer/audience, expired — all just "not authorized".
    return null
  }

  // `sub` is the WorkOS user id — the same value we store as `users.externalId`.
  const existing = await ctx.runQuery(internal.mcp.userIdForExternalId, { subject })
  if (existing) return existing

  // A verified WorkOS user who has never opened the app: provision them, exactly as the app
  // auto-provisions on first sign-in. Without this a valid login dead-ends with "no user"
  // (the confusing failure we hit first). They'll simply have no workspaces until they join
  // one. The profile comes from the WorkOS Management API — a trusted server-to-server call.
  const profile = await fetchWorkosProfile(subject)
  if (!profile) return null
  return ctx.runMutation(internal.mcp.provisionUser, { subject, ...profile })
}

/** Fetch a WorkOS user's profile (email + name + photo) by id, for auto-provisioning. Uses
 *  the server-side `WORKOS_API_KEY` — the same key the app already holds — so the email is
 *  trustworthy (unlike a client-supplied one). Returns null on any failure; the caller then
 *  simply rejects, which is the safe direction. */
async function fetchWorkosProfile(
  userId: string
): Promise<{ email: string; name?: string; avatarUrl?: string } | null> {
  const key = process.env.WORKOS_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`https://api.workos.com/user_management/users/${userId}`, {
      headers: { Authorization: `Bearer ${key}` }
    })
    if (!res.ok) return null
    const u = (await res.json()) as {
      email?: string
      first_name?: string | null
      last_name?: string | null
      profile_picture_url?: string | null
    }
    if (!u.email) return null
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
    return {
      email: u.email,
      name: name || undefined,
      avatarUrl: u.profile_picture_url ?? undefined
    }
  } catch {
    return null
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
