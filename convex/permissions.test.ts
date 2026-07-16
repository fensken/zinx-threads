/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { register as registerRateLimiter } from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

/**
 * Private channels, guests and announcement channels.
 *
 * The gate itself (`getChannelAccess`) is easy. **The leaks are in the enumerations** —
 * the sidebar, the URL resolver, search, threads, unread, the notification fan-out. This
 * suite exists to prove each one is closed, because a single missed one turns "private"
 * into a lie.
 *
 * The load-bearing case is the **admin**: a rank-based model (`_zinx`'s) would hand her
 * the channel, because admin > member. Membership-based access must not.
 */

const modules = import.meta.glob('./**/*.ts')

const ISSUER = 'https://test.workos'
const identityOf = (subject: string) => ({
  subject,
  issuer: ISSUER,
  tokenIdentifier: `${ISSUER}|${subject}`
})

async function drainScheduled(t: ReturnType<typeof convexTest>): Promise<void> {
  await t.finishAllScheduledFunctions(vi.runAllTimers)
}

/** Alice (owner) + Bob (member) + Carol (**admin** — the one that matters). */
async function setup() {
  const t = convexTest(schema, modules)
  registerRateLimiter(t)

  const asAlice = t.withIdentity(identityOf('user-alice'))
  await asAlice.mutation(api.users.store, { email: 'alice@example.com', name: 'Alice' })
  const { workspaceId, slug } = await asAlice.mutation(api.workspaces.create, { name: 'Acme' })

  const join = async (subject: string, email: string, name: string) => {
    const as = t.withIdentity(identityOf(subject))
    await as.mutation(api.users.store, { email, name })
    const { code } = await asAlice.mutation(api.invitations.invite, { workspaceId })
    await as.mutation(api.invitations.acceptByToken, { code })
    return as
  }
  const asBob = await join('user-bob', 'bob@example.com', 'Bob')
  const asCarol = await join('user-carol', 'carol@example.com', 'Carol')

  const idOf = async (email: string) =>
    await t.run(async (ctx) => {
      const u = await ctx.db
        .query('users')
        .withIndex('by_email', (q) => q.eq('email', email))
        .unique()
      return u!._id
    })
  const bobId = await idOf('bob@example.com')
  const carolId = await idOf('carol@example.com')

  /** `updateRole` keys on the membership row, not the user. */
  const memberIdOf = async (userId: typeof bobId) =>
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query('workspaceMembers')
        .withIndex('by_workspace_user', (q) =>
          q.eq('workspaceId', workspaceId).eq('userId', userId)
        )
        .unique()
      return m!._id
    })
  const setRole = async (userId: typeof bobId, role: 'admin' | 'member' | 'guest') =>
    await asAlice.mutation(api.members.updateRole, { memberId: await memberIdOf(userId), role })

  // Carol is an ADMIN. She must STILL be locked out of a private channel she isn't in.
  await setRole(carolId, 'admin')

  return { t, asAlice, asBob, asCarol, workspaceId, slug, bobId, carolId, setRole }
}

describe('private channels', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is invisible to a non-member — INCLUDING an admin', async () => {
    const { asAlice, asBob, asCarol, workspaceId, slug, bobId } = await setup()

    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'founders',
      kind: 'chat',
      visibility: 'private'
    })
    await asAlice.mutation(api.channelMembers.add, { channelId, userIds: [bobId] })
    await asAlice.mutation(api.messages.send, { channelId, body: 'secret plans' })

    // Members see it, everywhere.
    for (const who of [asAlice, asBob]) {
      expect(await who.query(api.channels.get, { channelId })).not.toBeNull()
      expect(await who.query(api.messages.listByChannel, { channelId })).toHaveLength(1)
      const names = (await who.query(api.channels.listBySlug, { slug })).map((c) => c.name)
      expect(names).toContain('founders')
    }

    // Carol is an ADMIN and is NOT in it. She gets nothing, from any surface.
    expect(await asCarol.query(api.channels.get, { channelId })).toBeNull()
    expect(await asCarol.query(api.messages.listByChannel, { channelId })).toHaveLength(0)

    const carolSees = (await asCarol.query(api.channels.listBySlug, { slug })).map((c) => c.name)
    expect(carolSees).not.toContain('founders')

    // Not by URL.
    expect(
      await asCarol.query(api.channels.resolveBySlug, {
        workspaceSlug: slug,
        channelSlug: 'founders'
      })
    ).toBeNull()

    // Not via SEARCH — whose index can only filter on workspaceId, so it genuinely
    // matches the message and must drop it afterwards.
    expect(
      await asCarol.query(api.messages.searchInWorkspace, { workspaceId, term: 'secret' })
    ).toHaveLength(0)
    // …while a member can still find it.
    expect(
      await asBob.query(api.messages.searchInWorkspace, { workspaceId, term: 'secret' })
    ).toHaveLength(1)

    // Can't post in.
    await expect(
      asCarol.mutation(api.messages.send, { channelId, body: 'let me in' })
    ).rejects.toThrow()

    // Can't even enumerate who is in it.
    expect(await asCarol.query(api.channelMembers.listByChannel, { channelId })).toHaveLength(0)
  })

  it('hides its THREADS — a thread name is a message preview', async () => {
    const { asAlice, asCarol, workspaceId } = await setup()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'private-threads',
      kind: 'chat',
      visibility: 'private'
    })
    const rootId = await asAlice.mutation(api.messages.send, {
      channelId,
      body: 'the acquisition is on'
    })
    await asAlice.mutation(api.threads.create, { messageId: rootId, name: 'acquisition' })

    expect(await asAlice.query(api.threads.listByWorkspace, { workspaceId })).toHaveLength(1)
    // The admin sees neither the thread nor its count.
    expect(await asCarol.query(api.threads.listByWorkspace, { workspaceId })).toHaveLength(0)
    expect(await asCarol.query(api.threads.countsByChannel, { workspaceId })).toHaveLength(0)
  })

  it('drops access, unread and inbox rows when someone is removed', async () => {
    const { t, asAlice, asBob, workspaceId, bobId } = await setup()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'private-1',
      kind: 'chat',
      visibility: 'private'
    })
    await asAlice.mutation(api.channelMembers.add, { channelId, userIds: [bobId] })
    await asAlice.mutation(api.messages.send, {
      channelId,
      body: `hey [@Bob](zinx://user/${bobId})`
    })
    expect(await asBob.query(api.inbox.listForMe, {})).toHaveLength(1)

    await asAlice.mutation(api.channelMembers.remove, { channelId, userId: bobId })
    await drainScheduled(t)

    expect(await asBob.query(api.channels.get, { channelId })).toBeNull()
    expect(await asBob.query(api.messages.listByChannel, { channelId })).toHaveLength(0)
    // The notification goes too: a row he can't open is a dead end that still leaks the
    // message preview of a conversation he's been shut out of.
    expect(await asBob.query(api.inbox.listForMe, {})).toHaveLength(0)
  })

  it('keeps @everyone inside the room', async () => {
    const { asAlice, asBob, asCarol, workspaceId, bobId } = await setup()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'private-2',
      kind: 'chat',
      visibility: 'private'
    })
    await asAlice.mutation(api.channelMembers.add, { channelId, userIds: [bobId] })
    await asAlice.mutation(api.messages.send, {
      channelId,
      body: 'heads up [@everyone](zinx://group/everyone)'
    })
    // Bob is in the room → pinged. Carol (admin, not in the room) → nothing.
    expect(await asBob.query(api.inbox.listForMe, {})).toHaveLength(1)
    expect(await asCarol.query(api.inbox.listForMe, {})).toHaveLength(0)
  })

  it('refuses to be shared with another workspace', async () => {
    const { asAlice, workspaceId } = await setup()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'private-3',
      kind: 'chat',
      visibility: 'private'
    })
    await expect(
      asAlice.mutation(api.sharedChannels.invite, { channelId, guestSlug: 'elsewhere' })
    ).rejects.toThrow()
  })

  it('seeds its creator, so nobody makes a room they cannot enter', async () => {
    const { asAlice, workspaceId } = await setup()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'private-4',
      kind: 'chat',
      visibility: 'private'
    })
    const members = await asAlice.query(api.channelMembers.listByChannel, { channelId })
    expect(members).toHaveLength(1)
    expect(members[0].name).toBe('Alice')
  })
})

describe('announcement channels', () => {
  it('is readable by everyone but writable only by owners/admins', async () => {
    const { asAlice, asBob, workspaceId } = await setup()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'announce',
      kind: 'chat'
    })
    await asAlice.mutation(api.channelMembers.setPostingPolicy, {
      channelId,
      postingPolicy: 'admins'
    })

    // Read-only, not invisible — that's the difference from private.
    expect(await asBob.query(api.channels.get, { channelId })).not.toBeNull()
    await expect(asBob.mutation(api.messages.send, { channelId, body: 'hi' })).rejects.toThrow()
    await expect(
      asAlice.mutation(api.messages.send, { channelId, body: 'ship it' })
    ).resolves.toBeDefined()
  })
})

describe('read-only channels (postingPolicy: selected)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** The case no role ladder can express: two people of the SAME rank, in the SAME
   *  channel, one of whom may talk. That's why posting rights live on the membership row. */
  it('lets the named people talk while everyone else watches', async () => {
    const { asAlice, asBob, asCarol, workspaceId, slug, bobId, carolId, setRole } = await setup()
    await setRole(carolId, 'member') // strip her admin — moderators can always post.

    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'standup',
      kind: 'chat'
    })
    await asAlice.mutation(api.channelMembers.setPostingPolicy, {
      channelId,
      postingPolicy: 'selected'
    })
    await asAlice.mutation(api.channelMembers.add, { channelId, userIds: [bobId] })
    await asAlice.mutation(api.messages.send, { channelId, body: 'morning' })

    // Read-only, not invisible — the whole difference from `private`. Both of them see it.
    for (const who of [asBob, asCarol]) {
      expect(await who.query(api.channels.get, { channelId })).not.toBeNull()
      expect(await who.query(api.messages.listByChannel, { channelId })).toHaveLength(1)
    }

    // Bob was named. Carol — same rank, same channel — was not.
    await expect(
      asBob.mutation(api.messages.send, { channelId, body: 'done' })
    ).resolves.toBeDefined()
    await expect(
      asCarol.mutation(api.messages.send, { channelId, body: 'me too' })
    ).rejects.toThrow()

    // The client is told, so it can render the lock instead of a composer that fails on send.
    const seenBy = async (as: typeof asBob) =>
      (await as.query(api.channels.listBySlug, { slug })).find((c) => c.name === 'standup')!
    expect((await seenBy(asBob)).canPost).toBe(true)
    expect((await seenBy(asCarol)).canPost).toBe(false)

    // Revoking is a live change, not a redeploy.
    await asAlice.mutation(api.channelMembers.setCanPost, {
      channelId,
      userId: bobId,
      canPost: false
    })
    await expect(asBob.mutation(api.messages.send, { channelId, body: 'again' })).rejects.toThrow()
    // …and he can still read every word of it.
    expect(await asBob.query(api.messages.listByChannel, { channelId })).toHaveLength(2)
  })

  it('mutes without evicting — a muted member of a PRIVATE channel still reads it', async () => {
    const { asAlice, asBob, workspaceId, bobId } = await setup()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'private-readonly',
      kind: 'chat',
      visibility: 'private'
    })
    await asAlice.mutation(api.channelMembers.add, { channelId, userIds: [bobId] })
    await asAlice.mutation(api.channelMembers.setPostingPolicy, {
      channelId,
      postingPolicy: 'selected'
    })
    await asAlice.mutation(api.channelMembers.setCanPost, {
      channelId,
      userId: bobId,
      canPost: false
    })
    await asAlice.mutation(api.messages.send, { channelId, body: 'read this' })

    // His row is what grants him sight of the channel, so muting must KEEP it.
    expect(await asBob.query(api.channels.get, { channelId })).not.toBeNull()
    expect(await asBob.query(api.messages.listByChannel, { channelId })).toHaveLength(1)
    await expect(asBob.mutation(api.messages.send, { channelId, body: 'hi' })).rejects.toThrow()
    // Nor can he route around the composer by opening a thread nobody could reply in.
    const [message] = await asBob.query(api.messages.listByChannel, { channelId })
    await expect(
      asBob.mutation(api.threads.create, { messageId: message._id, name: 'sneaky' })
    ).rejects.toThrow()
  })

  it('keeps a revoked talker’s unread + inbox rows when the channel is PUBLIC', async () => {
    const { t, asAlice, asBob, workspaceId, bobId } = await setup()
    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'public-readonly',
      kind: 'chat'
    })
    await asAlice.mutation(api.channelMembers.setPostingPolicy, {
      channelId,
      postingPolicy: 'selected'
    })
    await asAlice.mutation(api.channelMembers.add, { channelId, userIds: [bobId] })
    await asAlice.mutation(api.messages.send, {
      channelId,
      body: `over to you [@Bob](zinx://user/${bobId})`
    })
    expect(await asBob.query(api.inbox.listForMe, {})).toHaveLength(1)

    // In a PUBLIC channel the row only ever meant "may post". Taking it away must not
    // shred the history of a channel he can still read — that cleanup is for eviction.
    await asAlice.mutation(api.channelMembers.remove, { channelId, userId: bobId })
    await drainScheduled(t)

    expect(await asBob.query(api.channels.get, { channelId })).not.toBeNull()
    expect(await asBob.query(api.inbox.listForMe, {})).toHaveLength(1)
    await expect(asBob.mutation(api.messages.send, { channelId, body: 'hi' })).rejects.toThrow()
  })
})

describe('guests', () => {
  it('sees ONLY the channels they were added to — every channel acts private', async () => {
    const { asAlice, asBob, workspaceId, slug, bobId, setRole } = await setup()
    await setRole(bobId, 'guest')

    const open = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'open-chat',
      kind: 'chat'
    })
    const invited = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'guest-room',
      kind: 'chat'
    })
    await asAlice.mutation(api.channelMembers.add, { channelId: invited, userIds: [bobId] })

    const visible = (await asBob.query(api.channels.listBySlug, { slug })).map((c) => c.name)
    expect(visible).toEqual(['guest-room'])
    // Not even the workspace's default channel.
    expect(visible).not.toContain('general')
    expect(await asBob.query(api.channels.get, { channelId: open })).toBeNull()
  })

  it('cannot create channels or manage members', async () => {
    const { asAlice, asBob, workspaceId, bobId, carolId, setRole } = await setup()
    await setRole(bobId, 'guest')

    const room = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'guest-room-2',
      kind: 'chat'
    })
    await asAlice.mutation(api.channelMembers.add, { channelId: room, userIds: [bobId] })

    await expect(
      asBob.mutation(api.channels.create, { workspaceId, name: 'nope', kind: 'chat' })
    ).rejects.toThrow()
    // In the room, but still can't pull other people into it.
    await expect(
      asBob.mutation(api.channelMembers.add, { channelId: room, userIds: [carolId] })
    ).rejects.toThrow()
  })
})
