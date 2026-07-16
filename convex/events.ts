import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'
import { resolveAuthors } from './lib/messages'

/**
 * Calendar events.
 *
 * **Times are UTC instants; the zone is metadata.** The client converts a wall-clock
 * ("9:00 on the 18th") into an instant *in the workspace's zone* before sending it,
 * and every reader converts back into whatever zone they want to see. Nothing here
 * ever parses or formats a local time — that would bake the server's zone into the
 * data, which is the classic way an all-hands ends up an hour out for half the team.
 */

/** A calendar view asks for a month at a time; this bounds even a pathological range. */
const MAX_EVENTS = 500
/** Attendees on one event. Past this it's a channel announcement, not a meeting. */
const MAX_ATTENDEES = 200

const MAX_TITLE = 120
const MAX_TEXT = 2000

/** A reminder can't be earlier than a week before — past that it isn't a reminder,
 *  it's the calendar. Clamped rather than rejected: a nonsense value from a stale
 *  client shouldn't fail the whole save. */
const MAX_REMINDER_MINUTES = 7 * 24 * 60

function clampReminder(minutes: number | undefined): number | undefined {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return undefined
  return Math.min(Math.round(minutes), MAX_REMINDER_MINUTES)
}

export const rsvpStatus = v.union(
  v.literal('going'),
  v.literal('maybe'),
  v.literal('declined'),
  v.literal('invited')
)

export interface EventSummary {
  _id: Id<'events'>
  title: string
  description?: string
  location?: string
  startAt: number
  endAt: number
  allDay: boolean
  /** Minutes before the start to remind — 0/absent = none. */
  reminderMinutes: number
  /** The zone it was authored in — the client shows this time *and* the viewer's. */
  timezone: string
  channelId?: Id<'channels'>
  channelName?: string
  createdBy: Id<'users'>
  creatorName: string
  /** Whether the event came from an outside calendar (none do yet — see the schema). */
  external: boolean
  /** Your own RSVP, or null if you haven't answered. */
  myStatus: Doc<'eventAttendees'>['status'] | null
  going: number
  maybe: number
}

async function summarize(
  ctx: Parameters<typeof getCurrentUser>[0],
  rows: Doc<'events'>[],
  workspaceId: Id<'workspaces'>,
  userId: Id<'users'>
): Promise<EventSummary[]> {
  const creators = await resolveAuthors(
    ctx,
    workspaceId,
    rows.map((row) => row.createdBy)
  )
  const channelCache = new Map<string, string>()

  const out: EventSummary[] = []
  for (const row of rows) {
    // Bounded by MAX_ATTENDEES; a month of events costs one read per event.
    const attendees = await ctx.db
      .query('eventAttendees')
      .withIndex('by_event', (q) => q.eq('eventId', row._id))
      .take(MAX_ATTENDEES)

    let channelName: string | undefined
    if (row.channelId) {
      const key = row.channelId as string
      if (!channelCache.has(key)) {
        const channel = await ctx.db.get(row.channelId)
        // A DM is never a valid event channel (`create` refuses one), so this can't
        // leak a conversation's internal name.
        channelCache.set(key, channel && channel.kind !== 'dm' ? channel.name : '')
      }
      channelName = channelCache.get(key) || undefined
    }

    out.push({
      _id: row._id,
      title: row.title,
      description: row.description,
      location: row.location,
      startAt: row.startAt,
      endAt: row.endAt,
      allDay: row.allDay ?? false,
      reminderMinutes: row.reminderMinutes ?? 0,
      timezone: row.timezone,
      channelId: row.channelId,
      channelName,
      createdBy: row.createdBy,
      creatorName: creators.get(row.createdBy)?.name ?? 'Unknown',
      external: row.externalProvider !== undefined,
      myStatus: attendees.find((a) => a.userId === userId)?.status ?? null,
      going: attendees.filter((a) => a.status === 'going').length,
      maybe: attendees.filter((a) => a.status === 'maybe').length
    })
  }
  return out
}

/**
 * Events that **overlap** a range — the calendar's only read.
 *
 * The index is on `startAt`, so the range is widened backwards by `MAX_EVENT_SPAN`
 * to catch an event that started before the window and runs into it (a multi-day
 * offsite that begins on the 30th and is still going on the 2nd). Anything longer
 * than that span is dropped from the view rather than turning this into a full scan.
 */
const MAX_EVENT_SPAN = 30 * 24 * 60 * 60 * 1000

export const listRange = query({
  args: {
    workspaceId: v.id('workspaces'),
    /** UTC ms, inclusive. */
    from: v.number(),
    /** UTC ms, exclusive. */
    to: v.number()
  },
  handler: async (ctx, { workspaceId, from, to }): Promise<EventSummary[]> => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const rows = await ctx.db
      .query('events')
      .withIndex('by_workspace_start', (q) =>
        q
          .eq('workspaceId', workspaceId)
          .gte('startAt', from - MAX_EVENT_SPAN)
          .lt('startAt', to)
      )
      .take(MAX_EVENTS)

    // Started before the window AND ended before it — the widening caught it, but it
    // doesn't actually overlap.
    const overlapping = rows.filter((row) => row.endAt >= from)
    overlapping.sort((a, b) => a.startAt - b.startAt)
    return await summarize(ctx, overlapping, workspaceId, user._id)
  }
})

/** The next few events — the header's quick "what's coming up" flyout. */
export const listUpcoming = query({
  args: { workspaceId: v.id('workspaces'), limit: v.optional(v.number()) },
  handler: async (ctx, { workspaceId, limit }): Promise<EventSummary[]> => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const now = Date.now()
    const take = Math.min(Math.max(limit ?? 5, 1), 20)
    // Anything still running counts as upcoming, so start the scan a span back and
    // drop what has already finished.
    const rows = await ctx.db
      .query('events')
      .withIndex('by_workspace_start', (q) =>
        q.eq('workspaceId', workspaceId).gte('startAt', now - MAX_EVENT_SPAN)
      )
      .take(MAX_EVENTS)

    const live = rows.filter((row) => row.endAt >= now).sort((a, b) => a.startAt - b.startAt)
    return await summarize(ctx, live.slice(0, take), workspaceId, user._id)
  }
})

/** One event + its full attendee list (the detail dialog). Null if you can't see it. */
export const get = query({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null
    const event = await ctx.db.get(eventId)
    if (!event) return null
    if (!(await getMembership(ctx, event.workspaceId, user._id))) return null

    const attendees = await ctx.db
      .query('eventAttendees')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .take(MAX_ATTENDEES)
    const people = await resolveAuthors(
      ctx,
      event.workspaceId,
      attendees.map((a) => a.userId)
    )

    const [summary] = await summarize(ctx, [event], event.workspaceId, user._id)
    return {
      event: summary,
      canManage: event.createdBy === user._id,
      attendees: attendees.map((a) => ({
        userId: a.userId,
        status: a.status,
        name: people.get(a.userId)?.name ?? 'Unknown',
        color: people.get(a.userId)?.color,
        avatarUrl: people.get(a.userId)?.avatarUrl
      }))
    }
  }
})

function validate(args: {
  title: string
  startAt: number
  endAt: number
  description?: string
  location?: string
}): void {
  const title = args.title.trim()
  if (!title) throw new ConvexError('Give the event a title')
  if (title.length > MAX_TITLE) throw new ConvexError('That title is too long')
  if (!Number.isFinite(args.startAt) || !Number.isFinite(args.endAt)) {
    throw new ConvexError('That date is not valid')
  }
  if (args.endAt < args.startAt) throw new ConvexError('The event ends before it starts')
  if ((args.description?.length ?? 0) > MAX_TEXT)
    throw new ConvexError('That description is too long')
  if ((args.location?.length ?? 0) > MAX_TITLE) throw new ConvexError('That location is too long')
}

/** Create an event. Any member can — a calendar nobody may write to is a noticeboard.
 *  The **creator** is the only one who may edit or delete it (plus nobody else; a
 *  workspace admin override can come later if it's ever asked for). */
export const create = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    allDay: v.optional(v.boolean()),
    /** The zone the wall-clock was entered in — the workspace's, from the client. */
    timezone: v.string(),
    channelId: v.optional(v.id('channels')),
    reminderMinutes: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!(await getMembership(ctx, args.workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    validate(args)

    if (args.channelId) {
      const channel = await ctx.db.get(args.channelId)
      // The channel must be one of THIS workspace's, and never a DM — an event is
      // visible to every member, so tying it to a private conversation would leak it.
      // Not a DM, and not a PRIVATE channel: an event is visible to every member of the
      // workspace, so tying it to a room they can't enter would leak the room's existence
      // (and its name) through the calendar.
      if (
        !channel ||
        channel.workspaceId !== args.workspaceId ||
        channel.kind === 'dm' ||
        channel.visibility === 'private'
      ) {
        throw new ConvexError('That channel is not in this workspace')
      }
    }

    const now = Date.now()
    const eventId = await ctx.db.insert('events', {
      workspaceId: args.workspaceId,
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      location: args.location?.trim() || undefined,
      startAt: args.startAt,
      endAt: args.endAt,
      allDay: args.allDay,
      timezone: args.timezone,
      channelId: args.channelId,
      reminderMinutes: clampReminder(args.reminderMinutes),
      createdBy: user._id,
      createdAt: now,
      updatedAt: now
    })
    // The organiser is going — they scheduled it.
    await ctx.db.insert('eventAttendees', {
      eventId,
      workspaceId: args.workspaceId,
      userId: user._id,
      status: 'going',
      updatedAt: now
    })
    return eventId
  }
})

export const update = mutation({
  args: {
    eventId: v.id('events'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    timezone: v.optional(v.string()),
    channelId: v.optional(v.id('channels')),
    reminderMinutes: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    const event = await ctx.db.get(args.eventId)
    if (!event) throw new ConvexError('Event not found')
    if (event.createdBy !== user._id) {
      throw new ConvexError('Only the organiser can change this event')
    }

    const next = {
      title: args.title ?? event.title,
      description: args.description ?? event.description,
      location: args.location ?? event.location,
      startAt: args.startAt ?? event.startAt,
      endAt: args.endAt ?? event.endAt
    }
    validate(next)

    await ctx.db.patch(args.eventId, {
      title: next.title.trim(),
      description: next.description?.trim() || undefined,
      location: next.location?.trim() || undefined,
      startAt: next.startAt,
      endAt: next.endAt,
      allDay: args.allDay ?? event.allDay,
      timezone: args.timezone ?? event.timezone,
      channelId: args.channelId ?? event.channelId,
      reminderMinutes: clampReminder(args.reminderMinutes ?? event.reminderMinutes),
      updatedAt: Date.now()
    })
  }
})

/** Delete an event + its RSVPs. Bounded by `MAX_ATTENDEES`, so no scheduled cascade. */
export const remove = mutation({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const user = await requireUser(ctx)
    const event = await ctx.db.get(eventId)
    if (!event) return
    if (event.createdBy !== user._id) {
      throw new ConvexError('Only the organiser can delete this event')
    }
    const attendees = await ctx.db
      .query('eventAttendees')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .take(MAX_ATTENDEES)
    for (const row of attendees) await ctx.db.delete(row._id)
    await ctx.db.delete(eventId)
  }
})

/** Answer an invitation. Upserts your one row — RSVPing twice changes your answer,
 *  it doesn't add a second one (that's what `by_event_user` is for). */
export const rsvp = mutation({
  args: { eventId: v.id('events'), status: rsvpStatus },
  handler: async (ctx, { eventId, status }) => {
    const user = await requireUser(ctx)
    const event = await ctx.db.get(eventId)
    if (!event) throw new ConvexError('Event not found')
    if (!(await getMembership(ctx, event.workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }

    const existing = await ctx.db
      .query('eventAttendees')
      .withIndex('by_event_user', (q) => q.eq('eventId', eventId).eq('userId', user._id))
      .unique()

    const now = Date.now()
    if (existing) {
      if (existing.status !== status) await ctx.db.patch(existing._id, { status, updatedAt: now })
      return
    }
    await ctx.db.insert('eventAttendees', {
      eventId,
      workspaceId: event.workspaceId,
      userId: user._id,
      status,
      updatedAt: now
    })
  }
})
