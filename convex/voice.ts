import { ConvexError, v } from 'convex/values'
import { action, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'

// Voice/video calls run on a self-hosted LiveKit SFU (open-source, no participant
// cap). LiveKit needs a signed JWT per participant per room; we mint it here so
// the API secret NEVER reaches the renderer (same pattern as R2 / KLIPY):
//   npx convex env set LIVEKIT_API_KEY <key>
//   npx convex env set LIVEKIT_API_SECRET <secret>
// The renderer connects with this token to VITE_LIVEKIT_URL (the ws(s):// server
// URL — public, not a secret). Room name = the voice channel id, so a token only
// ever grants the one room the caller may access.

const TOKEN_TTL_SECONDS = 6 * 60 * 60 // 6h — long enough for a meeting, then re-mint

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function jsonToBase64Url(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

/** Mint a LiveKit access token (a standard HS256 JWT with a `video` grant),
 *  signed with Web Crypto so this stays in Convex's default runtime — no
 *  `livekit-server-sdk` (Node) dependency. */
async function mintAccessToken(opts: {
  apiKey: string
  apiSecret: string
  roomName: string
  identity: string
  name: string
}): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    exp: nowSeconds + TOKEN_TTL_SECONDS,
    nbf: nowSeconds,
    iss: opts.apiKey,
    sub: opts.identity,
    name: opts.name,
    // LiveKit VideoGrant: join this one room, publish + subscribe (audio, video,
    // screen share) + data messages.
    video: {
      room: opts.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    }
  }
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(opts.apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`
}

/** Server-side check that the caller may join this voice room. Returns the room
 *  name + the participant's identity/display name. Throws otherwise. */
export const canJoin = internalQuery({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await requireUser(ctx)
    const channel = await ctx.db.get(channelId)
    if (!channel) throw new ConvexError('Channel not found')
    if (channel.kind !== 'voice') throw new ConvexError('This is not a voice channel')
    const membership = await getMembership(ctx, channel.workspaceId, user._id)
    if (!membership) throw new ConvexError('Not a member of this workspace')
    return {
      roomName: channelId as string,
      identity: user._id as string,
      // Effective name = per-workspace nickname ?? global name (never the email id).
      name: membership.displayName ?? user.name ?? 'Member'
    }
  }
})

/** Mint a LiveKit token for the current user to join a voice channel's room.
 *  Membership + voice-kind gated (via `canJoin`); the secret stays server-side. */
export const getToken = action({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }): Promise<{ token: string }> => {
    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    if (!apiKey || !apiSecret) {
      throw new ConvexError('Voice calling is not configured on the server')
    }
    const { roomName, identity, name } = await ctx.runQuery(internal.voice.canJoin, { channelId })
    const token = await mintAccessToken({ apiKey, apiSecret, roomName, identity, name })
    return { token }
  }
})

// ── Voice presence (who's in each voice channel, for the sidebar) ──────────────
// Client-reported: the caller upserts their row on join + heartbeats it, deletes
// it on leave. A crashed client leaves ONE stale row that `listByWorkspace` drops
// once it's older than the TTL — and the next join overwrites it (one row/user).
const PRESENCE_TTL_MS = 45_000 // ~2× the client heartbeat; a missed beat = still shown

/** Report that the caller is connected to `channelId`'s call (join + heartbeat),
 *  with their in-call status for the sidebar icons. */
export const setPresence = mutation({
  args: {
    channelId: v.id('channels'),
    muted: v.optional(v.boolean()),
    deafened: v.optional(v.boolean()),
    videoOn: v.optional(v.boolean()),
    screenSharing: v.optional(v.boolean())
  },
  handler: async (ctx, { channelId, muted, deafened, videoOn, screenSharing }) => {
    const user = await requireUser(ctx)
    const channel = await ctx.db.get(channelId)
    if (!channel || channel.kind !== 'voice') return
    if (!(await getMembership(ctx, channel.workspaceId, user._id))) return

    const existing = await ctx.db
      .query('voicePresence')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique()
    const patch = {
      channelId,
      workspaceId: channel.workspaceId,
      muted: muted ?? false,
      deafened: deafened ?? false,
      videoOn: videoOn ?? false,
      screenSharing: screenSharing ?? false,
      updatedAt: Date.now()
    }
    if (existing) await ctx.db.patch(existing._id, patch)
    else await ctx.db.insert('voicePresence', { userId: user._id, ...patch })
  }
})

/** Report that the caller left the call (removes their presence row). */
export const clearPresence = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return
    const existing = await ctx.db
      .query('voicePresence')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique()
    if (existing) await ctx.db.delete(existing._id)
  }
})

/** Everyone currently in a voice channel in this workspace, keyed by channel — for
 *  the sidebar avatars. Null-safe + membership-gated; stale rows are filtered out. */
export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const now = Date.now()
    const rows = await ctx.db
      .query('voicePresence')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()

    const out: Array<{
      channelId: string
      userId: string
      name: string
      avatarUrl?: string
      color?: string
      muted: boolean
      deafened: boolean
      videoOn: boolean
      screenSharing: boolean
    }> = []
    for (const row of rows) {
      if (now - row.updatedAt >= PRESENCE_TTL_MS) continue
      const member = await ctx.db.get(row.userId)
      if (!member) continue
      out.push({
        channelId: row.channelId,
        userId: row.userId,
        name: member.name ?? 'Member',
        avatarUrl: member.avatarUrl,
        color: member.color,
        muted: row.muted ?? false,
        deafened: row.deafened ?? false,
        videoOn: row.videoOn ?? false,
        screenSharing: row.screenSharing ?? false
      })
    }
    return out
  }
})
