import { httpRouter } from 'convex/server'
import { ConvexError } from 'convex/values'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { callTool, handleRpc, TOOLS } from './lib/mcp'
import { protectedResourceMetadata, resolveMcpUser, wwwAuthenticate } from './lib/mcpAuth'
import { sha256Hex } from './lib/tokens'
import { BRAND } from './lib/brand'

/**
 * The app's HTTP surface, served from `https://<deployment>.convex.site` (NOT `.convex.cloud`
 * — HTTP actions live on the `.site` domain). It hosts the **MCP connector**: `/mcp`, that
 * Claude / ChatGPT / any MCP client connects to.
 *
 * Transport is **Streamable HTTP**: the client POSTs JSON-RPC 2.0 messages and we answer with
 * a single JSON response (no server→client stream — a GET gets 405, which the spec allows).
 *
 * Auth is OAuth 2.1 with **WorkOS AuthKit as the authorization server** (this endpoint is the
 * *resource server*): we publish Protected Resource Metadata pointing at AuthKit, and validate
 * the token WorkOS issued (`lib/mcpAuth.ts`). A personal access token (`zt_…`) is also
 * accepted, for the MCP Inspector and scripts. Either way the request acts as one user, so
 * every tool inherits that user's permissions.
 */

const http = httpRouter()

/** CORS so browser-based clients (the MCP Inspector) can reach the endpoint. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

/** 401 that tells a spec-compliant MCP client where to discover our authorization server, so
 *  it can run the OAuth flow itself (RFC 9728). */
function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'invalid_token' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': wwwAuthenticate(),
      ...CORS
    }
  })
}

const mcpEndpoint = httpAction(async (ctx, request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  // No server→client SSE stream (stateless request/response), which the spec permits.
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS })
  }

  // Bearer credential (WorkOS OAuth token OR personal access token) → user.
  const userId = await resolveMcpUser(ctx, request)
  if (!userId) return unauthorized()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
  }

  // A batch (array) or a single message. Notifications (no `id`) drop out of the response
  // array; if EVERY message was a notification, answer with a bare 202.
  const messages = Array.isArray(payload) ? payload : [payload]
  const responses: unknown[] = []
  for (const message of messages) {
    const response = await handleRpc(ctx, userId, message)
    if (response !== null) responses.push(response)
  }
  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS })
  return json(Array.isArray(payload) ? responses : responses[0])
})

http.route({ path: '/mcp', method: 'POST', handler: mcpEndpoint })
http.route({ path: '/mcp', method: 'GET', handler: mcpEndpoint })
http.route({ path: '/mcp', method: 'OPTIONS', handler: mcpEndpoint })

// --- OAuth resource-server discovery (RFC 9728) ----------------------------------------
// An MCP client that hits `/mcp` and gets a 401 reads the `resource_metadata` URL from the
// `WWW-Authenticate` header, fetches this document, and learns which authorization server
// (WorkOS AuthKit) to send the user to. Some clients also probe the path-suffixed variant.
const resourceMetadata = httpAction(async () => {
  return json(protectedResourceMetadata())
})
http.route({
  path: '/.well-known/oauth-protected-resource',
  method: 'GET',
  handler: resourceMetadata
})
http.route({
  path: '/.well-known/oauth-protected-resource/mcp',
  method: 'GET',
  handler: resourceMetadata
})

// --- Incoming webhooks (Slack-style) ---------------------------------------------------
// `POST /hooks/<secret>` with `{ "text": "…" }` posts the text into the webhook's channel AS
// the bot. No auth header — the secret IS the credential (in the URL, like Slack/Discord).
// The secret is matched by hash; an unknown/dead one gets 404 so we never confirm which
// secrets exist.
const webhookEndpoint = httpAction(async (ctx, request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS })
  }
  const secret = new URL(request.url).pathname.slice('/hooks/'.length)
  if (!secret) return json({ error: 'not_found' }, 404)

  // Accept JSON `{ text }` or a form/plain `text=` body (what curl `-d` and many CI tools send).
  let text = ''
  const contentType = request.headers.get('Content-Type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { text?: unknown }
      text = typeof body.text === 'string' ? body.text : ''
    } else {
      const raw = await request.text()
      const form = new URLSearchParams(raw)
      text = form.get('text') ?? raw
    }
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (!text.trim()) return json({ error: 'empty' }, 400)

  const delivered = await ctx.runMutation(internal.bots.deliverWebhook, {
    hashedToken: await sha256Hex(secret),
    text
  })
  if (!delivered) return json({ error: 'not_found' }, 404)
  return json({ ok: true })
})
http.route({ pathPrefix: '/hooks/', method: 'POST', handler: webhookEndpoint })
http.route({ pathPrefix: '/hooks/', method: 'OPTIONS', handler: webhookEndpoint })

// --- REST API (`/api/v1`) --------------------------------------------------------------
// A plain JSON-over-HTTP surface for scripts and integrations that don't speak MCP — the same
// capabilities, the same auth, the same permission gates. A capability is invoked with
// `POST /api/v1/tools/<name>` and a JSON body of its arguments; `GET /api/v1/tools` lists the
// catalog. Auth is a bearer token (a personal access token, a bot token, or a WorkOS OAuth
// JWT) — exactly what `/mcp` accepts — so the request acts as one user and can do only what
// that user can. This shares `callTool` with the MCP transport, so the two can never drift.
const apiEndpoint = httpAction(async (ctx, request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '')

  // Public liveness/info — no auth, no secrets.
  if (request.method === 'GET' && (path === '/api' || path === '/api/v1')) {
    return json({
      name: `${BRAND.productName} API`,
      version: 'v1',
      tools: `${url.origin}/api/v1/tools`,
      auth: 'Bearer token — create one in Settings → Developers (or a bot token). See /docs.'
    })
  }

  // Everything else needs a bearer credential (PAT / bot token / OAuth JWT) → a user.
  const userId = await resolveMcpUser(ctx, request)
  if (!userId) return unauthorized()

  // The capability catalog (same array MCP `tools/list` returns).
  if (request.method === 'GET' && path === '/api/v1/tools') {
    return json({ tools: TOOLS })
  }

  // Run a capability: POST /api/v1/tools/<name> with a JSON object of arguments.
  if (request.method === 'POST' && path.startsWith('/api/v1/tools/')) {
    const name = path.slice('/api/v1/tools/'.length)
    if (!name || !TOOLS.some((tool) => tool.name === name)) {
      return json({ ok: false, error: `Unknown tool "${name}"` }, 404)
    }
    let args: Record<string, unknown> = {}
    const raw = await request.text()
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return json({ ok: false, error: 'Body must be a JSON object of arguments' }, 400)
        }
        args = parsed as Record<string, unknown>
      } catch {
        return json({ ok: false, error: 'Body must be valid JSON' }, 400)
      }
    }
    try {
      const result = await callTool(ctx, userId, name, args)
      return json({ ok: true, result })
    } catch (error) {
      // Only surface a ConvexError's message (one we authored — a permission / not-found /
      // validation failure the caller can correct). An unexpected internal error must NOT leak
      // its stack or details; it becomes a generic 500.
      if (error instanceof ConvexError) {
        return json({ ok: false, error: String(error.data) }, 400)
      }
      console.error('API tool error:', error)
      return json({ ok: false, error: 'Internal error' }, 500)
    }
  }

  return json({ ok: false, error: 'Not found' }, 404)
})
http.route({ pathPrefix: '/api/', method: 'GET', handler: apiEndpoint })
http.route({ pathPrefix: '/api/', method: 'POST', handler: apiEndpoint })
http.route({ pathPrefix: '/api/', method: 'OPTIONS', handler: apiEndpoint })

export default http
