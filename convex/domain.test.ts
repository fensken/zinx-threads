/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { register as registerRateLimiter } from '@convex-dev/rate-limiter/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
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
        .withIndex('by_channel_thread_created', (q) => q.eq('channelId', channelId))
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
        .withIndex('by_channel_thread_created', (q) => q.eq('channelId', channelId))
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

describe('direct messages', () => {
  /** Alice's workspace + two more members, Bob and Carol. */
  async function setupThree() {
    const base = await setupOwner()
    const { t, asAlice, workspaceId } = base

    const join = async (subject: string, email: string, name: string) => {
      const as = t.withIdentity(identityOf(subject))
      await as.mutation(api.users.store, { email, name })
      return as
    }
    const asBob = await join('user-bob', 'bob@example.com', 'Bob')
    const asCarol = await join('user-carol', 'carol@example.com', 'Carol')

    const { code } = await asAlice.mutation(api.invitations.invite, { workspaceId })
    await asBob.mutation(api.invitations.acceptByToken, { code })
    await asCarol.mutation(api.invitations.acceptByToken, { code })

    const idOf = async (email: string) =>
      await t.run(async (ctx) => {
        const user = await ctx.db
          .query('users')
          .withIndex('by_email', (q) => q.eq('email', email))
          .unique()
        return user!._id
      })

    return {
      ...base,
      asBob,
      asCarol,
      bobId: await idOf('bob@example.com'),
      carolId: await idOf('carol@example.com')
    }
  }

  it('opens the same conversation twice instead of making two', async () => {
    const { asAlice, asBob, workspaceId, bobId, carolId } = await setupThree()

    const first = await asAlice.mutation(api.dms.open, { workspaceId, userIds: [bobId] })
    const again = await asAlice.mutation(api.dms.open, { workspaceId, userIds: [bobId] })
    expect(again).toBe(first)

    // Bob opening it from his side is the same conversation — the key is the set of
    // people, not who clicked first.
    const fromBob = await asBob.mutation(api.dms.open, {
      workspaceId,
      userIds: [await asAlice.query(api.users.me).then((me) => me!._id)]
    })
    expect(fromBob).toBe(first)

    // A different set of people is a different conversation.
    const group = await asAlice.mutation(api.dms.open, {
      workspaceId,
      userIds: [bobId, carolId]
    })
    expect(group).not.toBe(first)
  })

  it("does not let a workspace member read someone else's DM", async () => {
    const { asAlice, asBob, asCarol, workspaceId, bobId } = await setupThree()

    const dm = await asAlice.mutation(api.dms.open, { workspaceId, userIds: [bobId] })
    await asAlice.mutation(api.messages.send, { channelId: dm, body: 'just between us' })

    // Carol is a member of the workspace — that must grant her nothing here.
    expect(await asCarol.query(api.messages.listByChannel, { channelId: dm })).toEqual([])
    await expect(
      asCarol.mutation(api.messages.send, { channelId: dm, body: 'butting in' })
    ).rejects.toThrow()
    expect(await asCarol.query(api.channels.get, { channelId: dm })).toBeNull()
    expect(await asCarol.query(api.dms.listMine, { workspaceId })).toHaveLength(0)

    // The participants can.
    expect(await asBob.query(api.messages.listByChannel, { channelId: dm })).toHaveLength(1)
    expect(await asBob.query(api.dms.listMine, { workspaceId })).toHaveLength(1)
  })

  it('keeps DMs out of the channel list and the sidebar tree', async () => {
    const { asAlice, asCarol, workspaceId, slug, bobId } = await setupThree()
    await asAlice.mutation(api.dms.open, { workspaceId, userIds: [bobId] })

    // Neither a participant's channel list nor an outsider's contains it.
    for (const as of [asAlice, asCarol]) {
      const channels = await as.query(api.channels.listBySlug, { slug })
      expect(channels.some((channel) => channel.kind === 'dm')).toBe(false)
    }
  })

  it('refuses to message someone outside the workspace', async () => {
    const { t, asAlice, workspaceId } = await setupThree()
    const asMallory = t.withIdentity(identityOf('user-mallory'))
    await asMallory.mutation(api.users.store, { email: 'mallory@example.com' })
    const malloryId = await asMallory.query(api.users.me).then((me) => me!._id)

    await expect(
      asAlice.mutation(api.dms.open, { workspaceId, userIds: [malloryId] })
    ).rejects.toThrow()
  })

  it('notifies the recipient of every DM message, with no @ needed', async () => {
    const { asAlice, asBob, workspaceId, bobId } = await setupThree()
    const dm = await asAlice.mutation(api.dms.open, { workspaceId, userIds: [bobId] })
    await asAlice.mutation(api.messages.send, { channelId: dm, body: 'hello' })

    // The inbox is the USER's — no workspace argument.
    const inbox = await asBob.query(api.inbox.listForMe, {})
    expect(inbox).toHaveLength(1)
    expect(inbox[0].kind).toBe('dm')
    expect(inbox[0].workspaceId).toBe(workspaceId)
    // The DM's internal `dm-<ids>` name must never reach the client.
    expect(inbox[0].channelName).toBe('')

    // The sender doesn't notify themselves.
    expect(await asAlice.query(api.inbox.listForMe, {})).toHaveLength(0)

    // And it counts as unread for Bob — every message, not just mentions.
    const unread = await asBob.query(api.unread.listByWorkspace, { workspaceId })
    const entry = unread.find((row) => row.channelId === dm)
    expect(entry?.hasUnread).toBe(true)
    expect(entry?.mentionCount).toBe(1)
  })

  it('refuses a thread inside a DM', async () => {
    const { asAlice, workspaceId, bobId } = await setupThree()
    const dm = await asAlice.mutation(api.dms.open, { workspaceId, userIds: [bobId] })
    const messageId = await asAlice.mutation(api.messages.send, {
      channelId: dm,
      body: 'no threads here'
    })
    await expect(
      asAlice.mutation(api.threads.create, { messageId, name: 'side chat' })
    ).rejects.toThrow()
  })

  it('refuses to rename, move or delete a DM as if it were a channel', async () => {
    const { asAlice, workspaceId, bobId } = await setupThree()
    const dm = await asAlice.mutation(api.dms.open, { workspaceId, userIds: [bobId] })

    await expect(
      asAlice.mutation(api.channels.rename, { channelId: dm, name: 'x' })
    ).rejects.toThrow()
    await expect(asAlice.mutation(api.channels.move, { channelId: dm, order: 0 })).rejects.toThrow()
    await expect(asAlice.mutation(api.channels.remove, { channelId: dm })).rejects.toThrow()
  })
})

describe('events', () => {
  it('stores instants, not wall-clocks — and only the organiser may change one', async () => {
    const { t, asAlice, workspaceId } = await setupOwner()

    // 09:00 on 2026-07-20 in New York = 13:00 UTC (EDT, UTC-4). The CLIENT does this
    // conversion (`lib/timezone.ts` `inputsToUtc`); the server stores the instant and
    // the zone it was authored in, never a local string.
    const startAt = Date.UTC(2026, 6, 20, 13, 0)
    const endAt = Date.UTC(2026, 6, 20, 14, 0)
    const eventId = await asAlice.mutation(api.events.create, {
      workspaceId,
      title: 'Standup',
      startAt,
      endAt,
      timezone: 'America/New_York'
    })

    // A range that contains it, expressed in UTC.
    const inRange = await asAlice.query(api.events.listRange, {
      workspaceId,
      from: Date.UTC(2026, 6, 1),
      to: Date.UTC(2026, 7, 1)
    })
    expect(inRange).toHaveLength(1)
    expect(inRange[0].startAt).toBe(startAt)
    expect(inRange[0].timezone).toBe('America/New_York')
    // The organiser is going by default — they scheduled it.
    expect(inRange[0].myStatus).toBe('going')
    expect(inRange[0].going).toBe(1)

    // A range that doesn't.
    expect(
      await asAlice.query(api.events.listRange, {
        workspaceId,
        from: Date.UTC(2026, 7, 1),
        to: Date.UTC(2026, 8, 1)
      })
    ).toHaveLength(0)

    // An end before the start is refused.
    await expect(
      asAlice.mutation(api.events.create, {
        workspaceId,
        title: 'Backwards',
        startAt: endAt,
        endAt: startAt,
        timezone: 'America/New_York'
      })
    ).rejects.toThrow()

    // Bob joins, can RSVP, but can't edit or delete someone else's event.
    const asBob = t.withIdentity(identityOf('user-bob'))
    await asBob.mutation(api.users.store, { email: 'bob@example.com', name: 'Bob' })
    const { code } = await asAlice.mutation(api.invitations.invite, { workspaceId })
    await asBob.mutation(api.invitations.acceptByToken, { code })

    await asBob.mutation(api.events.rsvp, { eventId, status: 'going' })
    // RSVPing twice changes the answer; it doesn't add a second one.
    await asBob.mutation(api.events.rsvp, { eventId, status: 'maybe' })
    const detail = await asBob.query(api.events.get, { eventId })
    expect(detail!.attendees).toHaveLength(2)
    expect(detail!.event.going).toBe(1)
    expect(detail!.event.maybe).toBe(1)
    expect(detail!.canManage).toBe(false)

    await expect(
      asBob.mutation(api.events.update, { eventId, title: 'Hijacked' })
    ).rejects.toThrow()
    await expect(asBob.mutation(api.events.remove, { eventId })).rejects.toThrow()

    // A non-member sees nothing at all.
    const asMallory = t.withIdentity(identityOf('user-mallory'))
    await asMallory.mutation(api.users.store, { email: 'mallory@example.com' })
    expect(await asMallory.query(api.events.get, { eventId })).toBeNull()
    expect(
      await asMallory.query(api.events.listRange, {
        workspaceId,
        from: Date.UTC(2026, 6, 1),
        to: Date.UTC(2026, 7, 1)
      })
    ).toEqual([])
  })

  it('meets in a voice channel OR an external link — never a plain channel, never both', async () => {
    const { asAlice, workspaceId } = await setupOwner()
    const startAt = Date.UTC(2026, 6, 20, 13, 0)
    const endAt = Date.UTC(2026, 6, 20, 14, 0)
    const base = { workspaceId, startAt, endAt, timezone: 'America/New_York' } as const

    const voice = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'standup-call',
      kind: 'voice'
    })
    const chat = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'general-chat',
      kind: 'chat'
    })

    // A voice channel is a valid place to meet.
    const withVoice = await asAlice.mutation(api.events.create, {
      ...base,
      title: 'Standup',
      channelId: voice
    })
    // A non-voice channel is not — the whole point is you can jump into the call.
    await expect(
      asAlice.mutation(api.events.create, { ...base, title: 'Nope', channelId: chat })
    ).rejects.toThrow()

    // An external link is the other option, normalised to https.
    const withLink = await asAlice.mutation(api.events.create, {
      ...base,
      title: 'Zoom sync',
      url: 'zoom.us/j/123'
    })

    const detailVoice = await asAlice.query(api.events.get, { eventId: withVoice })
    expect(detailVoice!.event.channelName).toBe('standup-call')
    expect(detailVoice!.event.url).toBeUndefined()

    const detailLink = await asAlice.query(api.events.get, { eventId: withLink })
    expect(detailLink!.event.url).toBe('https://zoom.us/j/123')
    expect(detailLink!.event.channelId).toBeUndefined()

    // Switching a voice event to a link clears the channel (one place, not both).
    await asAlice.mutation(api.events.update, { eventId: withVoice, url: 'meet.google.com/abc' })
    const switched = await asAlice.query(api.events.get, { eventId: withVoice })
    expect(switched!.event.url).toBe('https://meet.google.com/abc')
    expect(switched!.event.channelId).toBeUndefined()

    // Clearing the link (null) leaves the event with no place.
    await asAlice.mutation(api.events.update, { eventId: withVoice, url: null })
    const cleared = await asAlice.query(api.events.get, { eventId: withVoice })
    expect(cleared!.event.url).toBeUndefined()
    expect(cleared!.event.channelId).toBeUndefined()
  })

  it('expands a recurring series into per-occurrence rows on read', async () => {
    const { asAlice, workspaceId } = await setupOwner()
    // Mon Jul 6 2026, 09:00 EDT = 13:00 UTC. No DST switch this month, so a weekly
    // step preserves the wall-clock exactly (+7 days).
    const startAt = Date.UTC(2026, 6, 6, 13, 0)
    const endAt = Date.UTC(2026, 6, 6, 14, 0)
    const eventId = await asAlice.mutation(api.events.create, {
      workspaceId,
      title: 'Weekly sync',
      startAt,
      endAt,
      timezone: 'America/New_York',
      kind: 'meeting',
      repeat: 'weekly',
      repeatUntil: Date.UTC(2026, 6, 28)
    })

    // Jul 6, 13, 20, 27 — four occurrences, all sharing the series id but with distinct
    // instance keys and per-occurrence start times a week apart.
    const occ = await asAlice.query(api.events.listRange, {
      workspaceId,
      from: Date.UTC(2026, 6, 1),
      to: Date.UTC(2026, 7, 1)
    })
    expect(occ).toHaveLength(4)
    expect(occ.every((o) => o._id === eventId)).toBe(true)
    expect(new Set(occ.map((o) => o.instanceKey)).size).toBe(4)
    expect(occ.every((o) => o.kind === 'meeting' && o.repeat === 'weekly' && o.isRecurring)).toBe(
      true
    )
    expect(occ[1].startAt - occ[0].startAt).toBe(7 * 24 * 60 * 60 * 1000)

    // `get` returns the SERIES itself (no expansion) — editing is whole-series.
    const detail = await asAlice.query(api.events.get, { eventId })
    expect(detail!.event.startAt).toBe(startAt)
    expect(detail!.event.repeat).toBe('weekly')

    // Turning recurrence off makes it a single occurrence again.
    await asAlice.mutation(api.events.update, { eventId, repeat: 'none' })
    const once = await asAlice.query(api.events.listRange, {
      workspaceId,
      from: Date.UTC(2026, 6, 1),
      to: Date.UTC(2026, 7, 1)
    })
    expect(once).toHaveLength(1)
    expect(once[0].repeat).toBe('none')
  })

  it('keeps a same-day timed repeatUntil, and does not repeat forever past it', async () => {
    const { asAlice, workspaceId } = await setupOwner()
    // Daily 09:00 EDT (13:00 UTC) on Jul 20, bounded to Jul 20 — `repeatUntil` names a DAY
    // (stored at midnight), which is BEFORE the 09:00 start. The bound must still cover that
    // day's occurrence (not be dropped as "before the start"), and the series must NOT run on.
    const startAt = Date.UTC(2026, 6, 20, 13, 0)
    const endAt = Date.UTC(2026, 6, 20, 14, 0)
    await asAlice.mutation(api.events.create, {
      workspaceId,
      title: 'One-day daily',
      startAt,
      endAt,
      timezone: 'America/New_York',
      kind: 'meeting',
      repeat: 'daily',
      repeatUntil: Date.UTC(2026, 6, 20)
    })

    // The start day shows exactly one occurrence (the bound was kept, not dropped).
    const sameDay = await asAlice.query(api.events.listRange, {
      workspaceId,
      from: Date.UTC(2026, 6, 20),
      to: Date.UTC(2026, 6, 21)
    })
    expect(sameDay).toHaveLength(1)

    // A week on: nothing. The bound held — it did NOT silently become an infinite series.
    const later = await asAlice.query(api.events.listRange, {
      workspaceId,
      from: Date.UTC(2026, 6, 27),
      to: Date.UTC(2026, 6, 28)
    })
    expect(later).toHaveLength(0)
  })

  it("finds today's occurrences of a long-running daily series (fast-forward)", async () => {
    const { asAlice, workspaceId } = await setupOwner()
    // A daily 12:00 UTC series that began ~2.5 years before the query window. The expansion
    // must FAST-FORWARD to the range (skipping whole steps, then aligning) — a naive
    // step-from-origin with a fixed iteration cap would drop the *current* occurrences.
    const startAt = Date.UTC(2024, 0, 1, 12, 0)
    const endAt = Date.UTC(2024, 0, 1, 13, 0)
    await asAlice.mutation(api.events.create, {
      workspaceId,
      title: 'Daily standup',
      startAt,
      endAt,
      timezone: 'UTC',
      kind: 'meeting',
      repeat: 'daily'
    })
    // Jul 20, 21, 22 2026 — three 12:00-UTC occurrences in the window. Exactly three (not two)
    // proves the fast-forward lands on, not past, the first in-range occurrence.
    const occ = await asAlice.query(api.events.listRange, {
      workspaceId,
      from: Date.UTC(2026, 6, 20),
      to: Date.UTC(2026, 6, 23)
    })
    expect(occ).toHaveLength(3)
  })
})

describe('the inbox belongs to the user, not a workspace', () => {
  it('spans every workspace, and filters by type and date', async () => {
    const { t, asAlice, workspaceId } = await setupOwner()

    // Bob joins Acme, and owns a second workspace that Alice also joins — so Alice
    // has notifications in two places at once, which is the whole point.
    const asBob = t.withIdentity(identityOf('user-bob'))
    await asBob.mutation(api.users.store, { email: 'bob@example.com', name: 'Bob' })
    const invite = await asAlice.mutation(api.invitations.invite, { workspaceId })
    await asBob.mutation(api.invitations.acceptByToken, { code: invite.code })

    const second = await asBob.mutation(api.workspaces.create, { name: 'Beta' })
    const invite2 = await asBob.mutation(api.invitations.invite, {
      workspaceId: second.workspaceId
    })
    await asAlice.mutation(api.invitations.acceptByToken, { code: invite2.code })

    const aliceId = await asAlice.query(api.users.me).then((me) => me!._id)

    // A DM in Acme, and a DM in Beta.
    const dm1 = await asBob.mutation(api.dms.open, { workspaceId, userIds: [aliceId] })
    await asBob.mutation(api.messages.send, { channelId: dm1, body: 'ping from acme' })
    const dm2 = await asBob.mutation(api.dms.open, {
      workspaceId: second.workspaceId,
      userIds: [aliceId]
    })
    await asBob.mutation(api.messages.send, { channelId: dm2, body: 'ping from beta' })

    // One list, both workspaces — no workspace argument anywhere.
    const all = await asAlice.query(api.inbox.listForMe, {})
    expect(all).toHaveLength(2)
    expect(new Set(all.map((row) => row.workspaceName))).toEqual(new Set(['Acme', 'Beta']))

    const count = await asAlice.query(api.inbox.unreadCountForMe, {})
    expect(count.count).toBe(2)

    // Type filter: these are DMs, so `mention` matches nothing.
    expect(await asAlice.query(api.inbox.listForMe, { kind: 'dm' })).toHaveLength(2)
    expect(await asAlice.query(api.inbox.listForMe, { kind: 'mention' })).toHaveLength(0)

    // Date filter: everything is from just now, so a future `since` excludes it all.
    expect(await asAlice.query(api.inbox.listForMe, { since: Date.now() + 60_000 })).toHaveLength(0)

    // Mark-all clears across BOTH workspaces in one call.
    await asAlice.mutation(api.inbox.markAllReadForMe, {})
    expect((await asAlice.query(api.inbox.unreadCountForMe, {})).count).toBe(0)
    expect((await asAlice.query(api.inbox.listForMe, {})).every((row) => row.read)).toBe(true)

    // Bob's own inbox is untouched — he sent them.
    expect(await asBob.query(api.inbox.listForMe, {})).toHaveLength(0)
  })
})

describe('scale invariants', () => {
  /** The default channel of Alice's workspace. */
  async function firstChannel(t: ReturnType<typeof convexTest>, slug: string) {
    const asAlice = t.withIdentity(identityOf('user-alice'))
    const channels = await asAlice.query(api.channels.listBySlug, { slug })
    return channels[0]
  }

  it('keeps the reaction summary on the message in step with the rows', async () => {
    const { t, asAlice, slug } = await setupOwner()
    const channel = await firstChannel(t, slug)
    const messageId = await asAlice.mutation(api.messages.send, {
      channelId: channel._id,
      body: 'react to me'
    })

    // A message is born with an (empty) summary, so reading it never falls back to
    // scanning `messageReactions`.
    const born = await t.run(async (ctx) => await ctx.db.get(messageId))
    expect(born?.reactions).toEqual([])

    await asAlice.mutation(api.messages.toggleReaction, { messageId, emoji: '👍' })
    const after = await t.run(async (ctx) => await ctx.db.get(messageId))
    expect(after?.reactions).toEqual([{ emoji: '👍', count: 1, userIds: [expect.any(String)] }])

    // The read path reports it, viewer-relative.
    const [rendered] = await asAlice.query(api.messages.listByChannel, { channelId: channel._id })
    expect(rendered.reactions).toEqual([{ emoji: '👍', count: 1, reacted: true }])

    // Un-reacting removes the pill entirely rather than leaving a zero-count entry.
    await asAlice.mutation(api.messages.toggleReaction, { messageId, emoji: '👍' })
    const cleared = await t.run(async (ctx) => await ctx.db.get(messageId))
    expect(cleared?.reactions).toEqual([])
  })

  it('renders reactions on a message written before the summary existed', async () => {
    const { t, asAlice, slug } = await setupOwner()
    const channel = await firstChannel(t, slug)
    const messageId = await asAlice.mutation(api.messages.send, {
      channelId: channel._id,
      body: 'legacy'
    })

    // Simulate a pre-migration row: reaction rows exist, but the message carries no
    // summary. The read path must fall back to the table, not claim zero reactions.
    await asAlice.mutation(api.messages.toggleReaction, { messageId, emoji: '🎉' })
    await t.run(async (ctx) => {
      await ctx.db.patch(messageId, { reactions: undefined })
    })

    const [rendered] = await asAlice.query(api.messages.listByChannel, { channelId: channel._id })
    expect(rendered.reactions).toEqual([{ emoji: '🎉', count: 1, reacted: true }])
  })

  it('tracks the newest message in channelActivity, and drops it with the channel', async () => {
    const { t, asAlice, workspaceId, slug } = await setupOwner()
    const channel = await firstChannel(t, slug)
    const extra = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'watermark',
      kind: 'chat'
    })

    const watermarkOf = async (channelId: Id<'channels'>) =>
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query('channelActivity')
          .withIndex('by_channel', (q) => q.eq('channelId', channelId))
          .unique()
        // `t.run` marshals `undefined` across the boundary as `null` — normalise.
        return row?.lastMessageAt ?? null
      })

    expect(await watermarkOf(extra)).toBeNull()
    await asAlice.mutation(api.messages.send, { channelId: extra, body: 'first' })
    const first = await watermarkOf(extra)
    expect(first).toBeGreaterThan(0)

    // The watermark moves forward with the newest message, and the OTHER channel's is
    // untouched — the whole point of the split is that one channel's traffic doesn't
    // write to anything the rest of the workspace reads.
    await asAlice.mutation(api.messages.send, { channelId: extra, body: 'second' })
    expect(await watermarkOf(extra)).toBeGreaterThanOrEqual(first!)
    expect(await watermarkOf(channel._id)).toBeNull()

    // It is a child of the channel and must not outlive it.
    vi.useFakeTimers()
    try {
      await asAlice.mutation(api.channels.remove, { channelId: extra })
      await drainScheduled(t)
    } finally {
      vi.useRealTimers()
    }
    expect(await watermarkOf(extra)).toBeNull()
  })
})

describe('silent messages', () => {
  it('a @silent message pings no one — even someone it @-mentions', async () => {
    const { t, asAlice, workspaceId } = await setupOwner()

    // Bob joins.
    const asBob = t.withIdentity(identityOf('user-bob'))
    await asBob.mutation(api.users.store, { email: 'bob@example.com', name: 'Bob' })
    const { code } = await asAlice.mutation(api.invitations.invite, { workspaceId })
    await asBob.mutation(api.invitations.acceptByToken, { code })
    const bobId = await t.run(async (ctx) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_email', (q) => q.eq('email', 'bob@example.com'))
        .unique()
      return user!._id
    })

    const channelId = await asAlice.mutation(api.channels.create, {
      workspaceId,
      name: 'announcements',
      kind: 'chat'
    })

    // A NORMAL @-mention of Bob: he gets an inbox row + a mention count.
    await asAlice.mutation(api.messages.send, {
      channelId,
      body: `[@Bob](zinx://user/${bobId}) standup in 5`
    })
    expect(await asBob.query(api.inbox.listForMe, {})).toHaveLength(1)
    const afterNormal = await asBob.query(api.unread.listByWorkspace, { workspaceId })
    expect(afterNormal.find((r) => r.channelId === channelId)?.mentionCount).toBe(1)

    // A SILENT @-mention of Bob: no new inbox row, and the mention count does NOT rise —
    // even though it still @-mentions him and lands in the channel.
    await asAlice.mutation(api.messages.send, {
      channelId,
      body: `[@Bob](zinx://user/${bobId}) fyi [@silent](zinx://directive/silent)`
    })
    expect(await asBob.query(api.inbox.listForMe, {})).toHaveLength(1)
    const afterSilent = await asBob.query(api.unread.listByWorkspace, { workspaceId })
    const entry = afterSilent.find((r) => r.channelId === channelId)
    // Still just the one ping from the normal message…
    expect(entry?.mentionCount).toBe(1)
    // …but the silent message is really there and still bolds the channel.
    expect(entry?.hasUnread).toBe(true)
    expect(await asBob.query(api.messages.listByChannel, { channelId })).toHaveLength(2)
  })
})
