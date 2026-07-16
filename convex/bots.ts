import { ConvexError, v } from 'convex/values'
import { action, internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { getChannelAccess, getCurrentUser, getMembership, requireUser } from './lib/auth'
import { mintToken } from './lib/tokens'
import { postMessageInChannel } from './lib/post'
import { colorFor } from './users'

/**
 * Bots — non-human members of a workspace.
 *
 * A bot is a real `users` row (`provider: 'bot'`) + a `workspaceMembers` row + a token. That
 * one decision buys the whole platform: its token flows through the SAME `resolveMcpUser` →
 * tool path a human connector uses, so the bot can post / read / create events AS ITSELF,
 * gated by the exact same `getChannelAccess` / `canPost` / membership checks. It also shows up
 * naturally as an author + member. See `schema.ts` `bots`.
 */

/** A workspace's bots are few — a fleet past this wants a real app-directory model. */
const MAX_BOTS = 25

/**
 * Create a bot: mint its token, then provision the principal + membership + registry row.
 * An **action** because generating the secret needs `crypto.getRandomValues`. Owner/admin
 * only (enforced in `provision`, where the db is). Returns the token exactly ONCE.
 */
export const create = action({
  args: { workspaceId: v.id('workspaces'), name: v.string() },
  handler: async (
    ctx,
    { workspaceId, name }
  ): Promise<{ botId: Id<'bots'>; token: string; name: string }> => {
    const label = name.trim().slice(0, 60) || 'Bot'
    const { token, hashedToken, preview } = await mintToken()
    const botId = await ctx.runMutation(internal.bots.provision, {
      workspaceId,
      name: label,
      hashedToken,
      preview
    })
    return { botId, token, name: label }
  }
})

/** Insert the bot principal (a users row that never signs in), its membership, the registry
 *  row, and its token. Owner/admin-gated. Auth propagates from `create`. */
export const provision = internalMutation({
  args: {
    workspaceId: v.id('workspaces'),
    name: v.string(),
    hashedToken: v.string(),
    preview: v.string()
  },
  handler: async (ctx, { workspaceId, name, hashedToken, preview }): Promise<Id<'bots'>> => {
    const user = await requireUser(ctx)
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can create bots')
    }
    const existing = await ctx.db
      .query('bots')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    if (existing.length >= MAX_BOTS) {
      throw new ConvexError(`A workspace can have at most ${MAX_BOTS} bots`)
    }

    const now = Date.now()
    // The bot's principal — a `users` row with a synthetic identity. `externalId` is derived
    // from the (unique) token hash, and the email is synthetic: a bot has no WorkOS identity,
    // so `getCurrentUser` (which keys on a WorkOS JWT) can never resolve to it. It only ever
    // acts through its token.
    const botUserId = await ctx.db.insert('users', {
      externalId: `bot:${hashedToken.slice(0, 32)}`,
      provider: 'bot',
      email: `bot-${hashedToken.slice(0, 8)}@bots.zinx.local`,
      name,
      color: colorFor(hashedToken)
    })
    const botId = await ctx.db.insert('bots', {
      workspaceId,
      userId: botUserId,
      name,
      createdBy: user._id,
      createdAt: now
    })
    await ctx.db.insert('workspaceMembers', {
      workspaceId,
      userId: botUserId,
      role: 'member',
      joinedAt: now
    })
    await ctx.db.insert('apiTokens', {
      userId: botUserId,
      hashedToken,
      name: `${name} token`,
      preview,
      botId,
      createdAt: now
    })
    return botId
  }
})

/** The workspace's bots — any member may see them (a bot is a visible member). Includes the
 *  token preview so the manager can identify it without ever showing the secret. */
export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const bots = await ctx.db
      .query('bots')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    return Promise.all(
      bots.map(async (bot) => {
        const botUser = await ctx.db.get(bot.userId)
        const token = await ctx.db
          .query('apiTokens')
          .withIndex('by_bot', (q) => q.eq('botId', bot._id))
          .first()
        const webhooks = await ctx.db
          .query('incomingWebhooks')
          .withIndex('by_bot', (q) => q.eq('botId', bot._id))
          .collect()
        return {
          _id: bot._id,
          userId: bot.userId,
          name: bot.name,
          color: botUser?.color,
          avatarUrl: botUser?.avatarUrl,
          tokenPreview: token?.preview,
          tokenLastUsedAt: token?.lastUsedAt,
          webhookCount: webhooks.length,
          createdAt: bot.createdAt
        }
      })
    )
  }
})

/**
 * Delete a bot: revoke its tokens + webhooks, remove its membership, drop the registry row —
 * but KEEP its `users` row, so the messages it posted stay attributed (Slack/Discord remove a
 * bot without erasing its history). Owner/admin only.
 */
export const remove = mutation({
  args: { botId: v.id('bots') },
  handler: async (ctx, { botId }) => {
    const user = await requireUser(ctx)
    const bot = await ctx.db.get(botId)
    if (!bot) return
    const membership = await getMembership(ctx, bot.workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can remove bots')
    }

    for (const token of await ctx.db
      .query('apiTokens')
      .withIndex('by_bot', (q) => q.eq('botId', botId))
      .collect()) {
      await ctx.db.delete(token._id)
    }
    for (const webhook of await ctx.db
      .query('incomingWebhooks')
      .withIndex('by_bot', (q) => q.eq('botId', botId))
      .collect()) {
      await ctx.db.delete(webhook._id)
    }
    const botMembership = await getMembership(ctx, bot.workspaceId, bot.userId)
    if (botMembership) await ctx.db.delete(botMembership._id)
    await ctx.db.delete(botId)
    // Drain the bot's channelReads + inbox rows (it was a member); its authored messages
    // stay, and so does its `users` row so they remain attributed.
    await ctx.scheduler.runAfter(0, internal.cleanup.member, {
      workspaceId: bot.workspaceId,
      userId: bot.userId
    })
  }
})

// ---------------------------------------------------------------------------
// Incoming webhooks — a per-channel URL an external service POSTs to, to post AS the bot.
// ---------------------------------------------------------------------------

/** Create an incoming webhook for a bot, pointed at one chat channel. Owner/admin only. Mints
 *  the URL secret; returns the full URL exactly ONCE. */
export const createWebhook = action({
  args: { botId: v.id('bots'), channelId: v.id('channels') },
  handler: async (ctx, { botId, channelId }): Promise<{ url: string; preview: string }> => {
    const { token, hashedToken, preview } = await mintToken()
    await ctx.runMutation(internal.bots.storeWebhook, { botId, channelId, hashedToken, preview })
    const site = (process.env.CONVEX_SITE_URL ?? '').replace(/\/$/, '')
    return { url: `${site}/hooks/${token}`, preview }
  }
})

/** Insert the webhook row. Owner/admin-gated; the channel must be a chat channel the bot can
 *  post in (so a webhook can't be aimed at a page/voice channel or one the bot was muted in). */
export const storeWebhook = internalMutation({
  args: {
    botId: v.id('bots'),
    channelId: v.id('channels'),
    hashedToken: v.string(),
    preview: v.string()
  },
  handler: async (ctx, { botId, channelId, hashedToken, preview }) => {
    const user = await requireUser(ctx)
    const bot = await ctx.db.get(botId)
    if (!bot) throw new ConvexError('Bot not found')
    const membership = await getMembership(ctx, bot.workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can create webhooks')
    }
    const channel = await ctx.db.get(channelId)
    if (!channel || channel.workspaceId !== bot.workspaceId || channel.kind !== 'chat') {
      throw new ConvexError('Pick a chat channel in this workspace')
    }
    // The bot must be able to post there (announcement / read-only channels refuse it).
    const access = await getChannelAccess(ctx, channelId, bot.userId)
    if (!access?.canPost) {
      throw new ConvexError('The bot cannot post in that channel')
    }
    await ctx.db.insert('incomingWebhooks', {
      workspaceId: bot.workspaceId,
      botId,
      channelId,
      hashedToken,
      preview,
      createdBy: user._id,
      createdAt: Date.now()
    })
  }
})

/**
 * Deliver a webhook POST: resolve the secret → the bot + channel, then post the text AS the
 * bot. Called by the `/hooks/<token>` HTTP endpoint. Returns `false` when the secret is
 * unknown or the bot can no longer post (so the endpoint answers 404 / 403 without leaking
 * which). Touches `lastUsedAt` so the UI can show "last fired".
 */
export const deliverWebhook = internalMutation({
  args: { hashedToken: v.string(), text: v.string() },
  handler: async (ctx, { hashedToken, text }): Promise<boolean> => {
    const webhook = await ctx.db
      .query('incomingWebhooks')
      .withIndex('by_hash', (q) => q.eq('hashedToken', hashedToken))
      .unique()
    if (!webhook) return false
    const trimmed = text.trim().slice(0, 4000)
    if (!trimmed) return false

    const channel = await ctx.db.get(webhook.channelId)
    const bot = await ctx.db.get(webhook.botId)
    if (!channel || !bot) return false
    const access = await getChannelAccess(ctx, channel._id, bot.userId)
    if (!access?.canPost) return false

    await postMessageInChannel(ctx, bot.userId, channel, access.accessWorkspaceId, trimmed)
    await ctx.db.patch(webhook._id, { lastUsedAt: Date.now() })
    return true
  }
})

/** A bot's webhooks — for the management UI. Member-visible (a webhook target is a channel
 *  they can already see); the secret is never returned, only the preview + channel. */
export const listWebhooks = query({
  args: { botId: v.id('bots') },
  handler: async (ctx, { botId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const bot = await ctx.db.get(botId)
    if (!bot || !(await getMembership(ctx, bot.workspaceId, user._id))) return []
    const rows = await ctx.db
      .query('incomingWebhooks')
      .withIndex('by_bot', (q) => q.eq('botId', botId))
      .collect()
    return Promise.all(
      rows.map(async (row) => {
        const channel = await ctx.db.get(row.channelId)
        return {
          _id: row._id,
          channelId: row.channelId,
          channelName: channel?.name ?? 'unknown',
          preview: row.preview,
          lastUsedAt: row.lastUsedAt,
          createdAt: row.createdAt
        }
      })
    )
  }
})

/** Delete a webhook — the URL stops working immediately. Owner/admin only. */
export const removeWebhook = mutation({
  args: { webhookId: v.id('incomingWebhooks') },
  handler: async (ctx, { webhookId }) => {
    const user = await requireUser(ctx)
    const webhook = await ctx.db.get(webhookId)
    if (!webhook) return
    const membership = await getMembership(ctx, webhook.workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can delete webhooks')
    }
    await ctx.db.delete(webhookId)
  }
})
