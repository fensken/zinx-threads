/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { register as registerRateLimiter } from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const ISSUER = 'https://test.workos'
const identityOf = (subject: string) => ({
  subject,
  issuer: ISSUER,
  tokenIdentifier: `${ISSUER}|${subject}`
})

/** A signed-in owner with a fresh workspace named "Acme". */
async function setupOwner() {
  const t = convexTest(schema, modules)
  // `messages.send` / `workspaces.create` / etc. call the rate-limiter component, so it
  // must be registered with the in-memory test instance or those calls throw.
  registerRateLimiter(t)
  const asAlice = t.withIdentity(identityOf('user-alice'))
  await asAlice.mutation(api.users.store, { email: 'alice@example.com', name: 'Alice' })
  const { workspaceId, slug } = await asAlice.mutation(api.workspaces.create, { name: 'Acme' })
  return { t, asAlice, workspaceId, slug }
}

/** Drain the background cascade (self-rescheduling `runAfter(0)` cleanup jobs).
 *  `finishAllScheduledFunctions` fires pending timers in a loop until the queue
 *  empties — so it follows the whole chain (workspace → channel → re-batch).
 *  Requires fake timers (see the `cascade deletes` hooks). */
async function drainScheduled(t: ReturnType<typeof convexTest>): Promise<void> {
  await t.finishAllScheduledFunctions(vi.runAllTimers)
}

describe('cascade deletes', () => {
  // Fake timers so `finishAllScheduledFunctions` can drive the `runAfter(0)`
  // cleanup chain deterministically.
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('deleting a channel removes its messages, reactions, threads and replies', async () => {
    const { t, asAlice, workspaceId } = await setupOwner()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'general two',
      kind: 'chat'
    })
    const messageId = await asAlice.mutation(api.messages.send, { channelId, body: 'hello' })
    await asAlice.mutation(api.messages.toggleReaction, { messageId, emoji: '👍' })
    const threadId = await asAlice.mutation(api.threads.create, { messageId, name: 'a thread' })
    await asAlice.mutation(api.messages.send, { channelId, body: 'a reply', threadId })

    await asAlice.mutation(api.channels.remove, { channelId })
    await drainScheduled(t)

    await t.run(async (ctx) => {
      const messages = await ctx.db
        .query('messages')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .collect()
      const reactions = await ctx.db
        .query('messageReactions')
        .withIndex('by_message', (q) => q.eq('messageId', messageId))
        .collect()
      const threads = await ctx.db
        .query('threads')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .collect()
      expect(messages).toHaveLength(0) // channel messages AND thread replies
      expect(reactions).toHaveLength(0)
      expect(threads).toHaveLength(0)
      expect(await ctx.db.get(channelId)).toBeNull()
    })
  })

  it('deleting a message that roots a thread cascades the whole thread', async () => {
    const { t, asAlice, workspaceId } = await setupOwner()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'chat x',
      kind: 'chat'
    })
    const rootId = await asAlice.mutation(api.messages.send, { channelId, body: 'root' })
    const threadId = await asAlice.mutation(api.threads.create, { messageId: rootId, name: 't' })
    const replyId = await asAlice.mutation(api.messages.send, {
      channelId,
      body: 'reply',
      threadId
    })

    await asAlice.mutation(api.messages.remove, { messageId: rootId })
    await drainScheduled(t)

    await t.run(async (ctx) => {
      expect(await ctx.db.get(rootId)).toBeNull()
      expect(await ctx.db.get(threadId)).toBeNull()
      expect(await ctx.db.get(replyId)).toBeNull()
    })
  })

  it('deleting a message removes its reactions', async () => {
    const { t, asAlice, workspaceId } = await setupOwner()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'reactions',
      kind: 'chat'
    })
    const messageId = await asAlice.mutation(api.messages.send, { channelId, body: 'react to me' })
    await asAlice.mutation(api.messages.toggleReaction, { messageId, emoji: '🎉' })

    await asAlice.mutation(api.messages.remove, { messageId })

    await t.run(async (ctx) => {
      const reactions = await ctx.db
        .query('messageReactions')
        .withIndex('by_message', (q) => q.eq('messageId', messageId))
        .collect()
      expect(reactions).toHaveLength(0)
      expect(await ctx.db.get(messageId)).toBeNull()
    })
  })

  it('deleting a workspace removes its channels, members and messages', async () => {
    const { t, asAlice, workspaceId } = await setupOwner()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'extra',
      kind: 'chat'
    })
    await asAlice.mutation(api.messages.send, { channelId, body: 'hi' })

    await asAlice.mutation(api.workspaces.remove, { workspaceId, confirmName: 'Acme' })
    await drainScheduled(t)

    await t.run(async (ctx) => {
      const channels = await ctx.db
        .query('channels')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .collect()
      const members = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .collect()
      const messages = await ctx.db
        .query('messages')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .collect()
      expect(await ctx.db.get(workspaceId)).toBeNull()
      expect(channels).toHaveLength(0)
      expect(members).toHaveLength(0)
      expect(messages).toHaveLength(0)
    })
  })
})

describe('invitations are capability tokens', () => {
  it('lets a second user join with the code, and rejects a bad one', async () => {
    const { t, asAlice, workspaceId, slug } = await setupOwner()
    const { code } = await asAlice.mutation(api.invitations.invite, { workspaceId })

    const asBob = t.withIdentity(identityOf('user-bob'))
    await asBob.mutation(api.users.store, { email: 'bob@example.com', name: 'Bob' })

    expect((await asBob.query(api.invitations.preview, { code })).valid).toBe(true)
    expect((await asBob.query(api.invitations.preview, { code: 'not-real' })).valid).toBe(false)

    const result = await asBob.mutation(api.invitations.acceptByToken, { code })
    expect(result.slug).toBe(slug)

    const mine = await asBob.query(api.workspaces.myWorkspaces)
    expect(mine.some((entry) => entry.workspace._id === workspaceId)).toBe(true)
  })

  it('refuses acceptance of a made-up code', async () => {
    const { t } = await setupOwner()
    const asBob = t.withIdentity(identityOf('user-bob'))
    await asBob.mutation(api.users.store, { email: 'bob@example.com' })
    await expect(
      asBob.mutation(api.invitations.acceptByToken, { code: 'garbage' })
    ).rejects.toThrow()
  })
})

describe('authorization is derived server-side', () => {
  it('rejects a non-member trying to post in a channel', async () => {
    const { t, asAlice, workspaceId } = await setupOwner()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'members only',
      kind: 'chat'
    })

    const asBob = t.withIdentity(identityOf('user-bob'))
    await asBob.mutation(api.users.store, { email: 'bob@example.com' })
    await expect(asBob.mutation(api.messages.send, { channelId, body: 'sneaky' })).rejects.toThrow()
  })

  it('refuses to delete the home (default) channel', async () => {
    const { t, asAlice, workspaceId } = await setupOwner()
    const defaultChannel = await t.run(async (ctx) => {
      const channels = await ctx.db
        .query('channels')
        .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
        .collect()
      return channels.find((channel) => channel.isDefault)
    })
    expect(defaultChannel).toBeTruthy()
    await expect(
      asAlice.mutation(api.channels.remove, { channelId: defaultChannel!._id })
    ).rejects.toThrow()
  })
})

describe('voice presence', () => {
  it('reports, lists, and clears who is in a voice channel', async () => {
    const { asAlice, workspaceId } = await setupOwner()
    const voiceChannel = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'lounge',
      kind: 'voice'
    })

    await asAlice.mutation(api.voice.setPresence, { channelId: voiceChannel })
    const list = await asAlice.query(api.voice.listByWorkspace, { workspaceId })
    expect(list).toHaveLength(1)
    expect(list[0].channelId).toBe(voiceChannel)

    await asAlice.mutation(api.voice.clearPresence, {})
    expect(await asAlice.query(api.voice.listByWorkspace, { workspaceId })).toHaveLength(0)
  })

  it('ignores a presence report for a non-voice channel', async () => {
    const { asAlice, workspaceId } = await setupOwner()
    const chatChannel = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'general x',
      kind: 'chat'
    })
    await asAlice.mutation(api.voice.setPresence, { channelId: chatChannel })
    expect(await asAlice.query(api.voice.listByWorkspace, { workspaceId })).toHaveLength(0)
  })
})
