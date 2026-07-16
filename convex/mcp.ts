import { ConvexError, v } from 'convex/values'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { requireUser } from './lib/auth'
import { API_TOKEN_PREFIX } from './lib/brand'
import { colorFor, nameFromEmail } from './users'

/**
 * **API tokens + the identity resolution** behind the developer surfaces (MCP connector, REST
 * API, bots). This file is the token lifecycle and the token/OAuth → user mapping; the actual
 * capabilities each token can drive live in `convex/apiTools.ts`, dispatched by
 * `convex/lib/mcp.ts` and served over HTTP by `convex/http.ts`.
 *
 * A token acts AS the user who minted it (or, for a bot token, AS the bot user). Every
 * capability then goes through the SAME `getMembership` / `getChannelAccess` / `canPost` gates
 * the app's own functions use, so a token can only ever do what its owner can.
 */

/** Distinct tokens per user — enough for Claude + ChatGPT + a couple of scripts. */
const MAX_TOKENS = 10

// ---------------------------------------------------------------------------
// Token lifecycle
// ---------------------------------------------------------------------------

/**
 * Mint a token. An **action** because generating the secret needs `crypto.getRandomValues`,
 * which is non-deterministic and therefore forbidden in a mutation. Returns the raw token
 * exactly once — we store only its hash, so this is the only moment it exists in the clear.
 */
export const createToken = action({
  args: { name: v.string() },
  handler: async (ctx, { name }): Promise<{ token: string; name: string; preview: string }> => {
    const label = name.trim().slice(0, 60) || 'API token'

    // 32 random bytes → base64url. The `zt_` prefix (from `brand.ts`) makes a leaked secret
    // greppable + obviously ours (the same reason GitHub prefixes `ghp_`).
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const token = API_TOKEN_PREFIX + toBase64Url(bytes)
    const hashedToken = await sha256Hex(token)
    const preview = token.slice(0, API_TOKEN_PREFIX.length + 8)

    await ctx.runMutation(internal.mcp.storeToken, { hashedToken, name: label, preview })
    return { token, name: label, preview }
  }
})

/** Insert the token row. Internal — only `createToken` calls it, with a precomputed hash
 *  (no crypto here; a mutation is deterministic). Auth propagates from the action. */
export const storeToken = internalMutation({
  args: { hashedToken: v.string(), name: v.string(), preview: v.string() },
  handler: async (ctx, { hashedToken, name, preview }) => {
    const user = await requireUser(ctx)
    const existing = await ctx.db
      .query('apiTokens')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()
    if (existing.length >= MAX_TOKENS) {
      throw new ConvexError(`You can have at most ${MAX_TOKENS} tokens. Revoke one first.`)
    }
    await ctx.db.insert('apiTokens', {
      userId: user._id,
      hashedToken,
      name,
      preview,
      createdAt: Date.now()
    })
  }
})

/** The caller's tokens — never the secret (we don't have it), just the label + preview so a
 *  row is identifiable and revocable. Excludes bot tokens (those are managed under Bots). */
export const listTokens = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    const rows = await ctx.db
      .query('apiTokens')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()
    return rows
      .filter((row) => !row.botId)
      .map((row) => ({
        _id: row._id,
        name: row.name,
        preview: row.preview,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }
})

/** Revoke a token — the AI holding it loses access on its next request. Owner-checked. */
export const revokeToken = mutation({
  args: { tokenId: v.id('apiTokens') },
  handler: async (ctx, { tokenId }) => {
    const user = await requireUser(ctx)
    const row = await ctx.db.get(tokenId)
    if (!row || row.userId !== user._id) throw new ConvexError('Token not found')
    await ctx.db.delete(tokenId)
  }
})

// ---------------------------------------------------------------------------
// Identity resolution — a bearer credential → our user row
// ---------------------------------------------------------------------------

/** Resolve a token hash to its user id, or null. Called by the HTTP handlers on every request,
 *  so it's a single indexed read and nothing more. Also bumps `lastUsedAt` is deliberately NOT
 *  done here (a query can't write); the transports don't need it hot. */
export const userIdForToken = internalQuery({
  args: { hashedToken: v.string() },
  handler: async (ctx, { hashedToken }): Promise<Id<'users'> | null> => {
    const row = await ctx.db
      .query('apiTokens')
      .withIndex('by_hash', (q) => q.eq('hashedToken', hashedToken))
      .unique()
    return row?.userId ?? null
  }
})

/** Resolve a WorkOS user id (the OAuth token's `sub`) to our user row. This is the OAuth path's
 *  equivalent of `getCurrentUser` — keyed on the subject from a verified AuthKit JWT, since an
 *  MCP token comes from a different issuer than the app's session token (so its
 *  `tokenIdentifier` never matches ours). `externalId` stores the raw WorkOS subject, which is
 *  what both tokens share. */
export const userIdForExternalId = internalQuery({
  args: { subject: v.string() },
  handler: async (ctx, { subject }): Promise<Id<'users'> | null> => {
    const row = await ctx.db
      .query('users')
      .withIndex('by_external_id', (q) => q.eq('externalId', subject))
      .unique()
    return row?._id ?? null
  }
})

/**
 * Provision a Convex user for a WorkOS subject that authenticated via OAuth but has never opened
 * the app. The connector is just another sign-in surface, so it provisions the same way the app
 * does (Path A auto-provision) — otherwise a perfectly valid login would fail with "no user".
 * A brand-new user has no workspaces, so this grants nothing on its own; it just lets the
 * connection succeed. Idempotent: a race between two first requests can't create two rows.
 */
export const provisionUser = internalMutation({
  args: {
    subject: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string())
  },
  handler: async (ctx, { subject, email, name, avatarUrl }): Promise<Id<'users'>> => {
    const existing = await ctx.db
      .query('users')
      .withIndex('by_external_id', (q) => q.eq('externalId', subject))
      .unique()
    if (existing) return existing._id

    const normalizedEmail = email.trim().toLowerCase()
    return ctx.db.insert('users', {
      externalId: subject,
      provider: 'workos',
      email: normalizedEmail,
      // The email came from the WorkOS Management API (a trusted server-to-server call), so
      // unlike the client-supplied path it IS verified.
      emailVerified: true,
      name: name?.trim() || nameFromEmail(normalizedEmail),
      avatarUrl,
      color: colorFor(subject)
    })
  }
})

// ---------------------------------------------------------------------------
// Crypto helpers (run in the actions runtime — `convex/http.ts` uses `sha256Hex` too)
// ---------------------------------------------------------------------------

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
