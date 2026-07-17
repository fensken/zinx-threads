import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'
import { resolveAuthors } from './lib/messages'
import { expandEventToRange, type EventInstance } from './lib/recurrence'

/** What kind of event — colours the calendar and drives the Type filter. */
export const eventKind = v.union(
  v.literal('meeting'),
  v.literal('deadline'),
  v.literal('reminder'),
  v.literal('other')
)
/** How an event repeats. `'none'` is the client's word for "no recurrence"; it's
 *  stored as an absent `repeat` (the column only ever holds an active unit). */
export const eventRepeat = v.union(
  v.literal('none'),
  v.literal('daily'),
  v.literal('weekly'),
  v.literal('monthly')
)
type EventKind = 'meeting' | 'deadline' | 'reminder' | 'other'
type EventRepeat = 'none' | 'daily' | 'weekly' | 'monthly'

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

/** How recurrence is STORED: `'none'` collapses to an absent `repeat`, and `repeatUntil`
 *  is dropped unless it's a real bound at/after the start (a one-off has no "until", and
 *  an "until" before the start would produce zero occurrences). */
function normalizeRepeat(
  repeat: EventRepeat | undefined,
  repeatUntil: number | undefined,
  startAt: number
): { repeat?: 'daily' | 'weekly' | 'monthly'; repeatUntil?: number } {
  if (!repeat || repeat === 'none') return { repeat: undefined, repeatUntil: undefined }
  // `repeatUntil` names a DAY (stored at midnight); a same-day timed start is still a
  // valid one-occurrence bound, so compare against the END of the until-day, not midnight
  // (matches `lib/recurrence.ts` extending the bound). Only a bound strictly before the
  // start day is dropped (it would yield zero occurrences).
  const until =
    repeatUntil !== undefined &&
    Number.isFinite(repeatUntil) &&
    repeatUntil + 24 * 3_600_000 > startAt
      ? repeatUntil
      : undefined
  return { repeat, repeatUntil: until }
}

const MAX_URL = 500

/** Normalise an external meeting link to an `http(s)` URL, or throw. An empty
 *  string means "no link" (the caller clears the field). A bare `zoom.us/…` is
 *  assumed https so the user needn't type the scheme. */
function normalizeUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (withProto.length > MAX_URL) throw new ConvexError('That link is too long')
  try {
    const parsed = new URL(withProto)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ConvexError('The link must be an http(s) URL')
    }
  } catch {
    throw new ConvexError('That doesn’t look like a valid link')
  }
  return withProto
}

/** Resolve + validate the voice channel an event meets in. Returns the id to store,
 *  or throws. An event is visible to the whole workspace, so the channel must be one
 *  of THIS workspace's, must be a **voice** channel (that's the whole point — you jump
 *  into the call from the event), and never a DM or a private room (which would leak
 *  its existence through the calendar). */
async function resolveVoiceChannel(
  ctx: Parameters<typeof getCurrentUser>[0],
  workspaceId: Id<'workspaces'>,
  channelId: Id<'channels'>
): Promise<Id<'channels'>> {
  const channel = await ctx.db.get(channelId)
  if (
    !channel ||
    channel.workspaceId !== workspaceId ||
    channel.kind !== 'voice' ||
    channel.visibility === 'private'
  ) {
    throw new ConvexError('Pick a voice channel in this workspace')
  }
  return channelId
}

export const rsvpStatus = v.union(
  v.literal('going'),
  v.literal('maybe'),
  v.literal('declined'),
  v.literal('invited')
)

export interface EventSummary {
  _id: Id<'events'>
  /** Unique per *occurrence* — `${_id}:${startAt}` — since a recurring series expands
   *  into many rows that share `_id`. Use this for React keys; `_id` for edit/RSVP. */
  instanceKey: string
  title: string
  description?: string
  location?: string
  /** The OCCURRENCE times (a recurring series' expanded instance), not the series row. */
  startAt: number
  endAt: number
  allDay: boolean
  kind: EventKind
  /** `'none'` unless recurring; `repeatUntil` (UTC ms) bounds an active series. */
  repeat: EventRepeat
  repeatUntil?: number
  /** True when this row is an expanded occurrence of a recurring series. */
  isRecurring: boolean
  /** Minutes before the start to remind — 0/absent = none. */
  reminderMinutes: number
  /** The zone it was authored in — the client shows this time *and* the viewer's. */
  timezone: string
  /** The voice channel to meet in (if any). */
  channelId?: Id<'channels'>
  channelName?: string
  /** Its `kind` (always `'voice'` today) — so the UI shows the matching channel icon. */
  channelKind?: string
  /** An external meeting link (if any) — mutually exclusive with `channelId`. */
  url?: string
  createdBy: Id<'users'>
  creatorName: string
  /** Whether the event came from an outside calendar (none do yet — see the schema). */
  external: boolean
  /** Your own RSVP, or null if you haven't answered. */
  myStatus: Doc<'eventAttendees'>['status'] | null
  going: number
  maybe: number
}

/** Enrich occurrence instances into `EventSummary`s. Attendees + channel names are
 *  cached by the SERIES id, so a recurring event expanded into 30 occurrences costs one
 *  attendee read, not thirty. */
async function summarize(
  ctx: Parameters<typeof getCurrentUser>[0],
  instances: EventInstance[],
  workspaceId: Id<'workspaces'>,
  userId: Id<'users'>
): Promise<EventSummary[]> {
  const creators = await resolveAuthors(
    ctx,
    workspaceId,
    instances.map((inst) => inst.event.createdBy)
  )
  const channelCache = new Map<string, { name: string; kind: string } | null>()
  const attendeeCache = new Map<string, Doc<'eventAttendees'>[]>()

  const out: EventSummary[] = []
  for (const { event: row, startAt, endAt } of instances) {
    const eventKey = row._id as string
    let attendees = attendeeCache.get(eventKey)
    if (!attendees) {
      // Bounded by MAX_ATTENDEES; one read per distinct series, not per occurrence.
      attendees = await ctx.db
        .query('eventAttendees')
        .withIndex('by_event', (q) => q.eq('eventId', row._id))
        .take(MAX_ATTENDEES)
      attendeeCache.set(eventKey, attendees)
    }

    let channelName: string | undefined
    let channelKind: string | undefined
    if (row.channelId) {
      const key = row.channelId as string
      if (!channelCache.has(key)) {
        const channel = await ctx.db.get(row.channelId)
        // A DM is never a valid event channel (`create` refuses one), so this can't
        // leak a conversation's internal name.
        channelCache.set(
          key,
          channel && channel.kind !== 'dm' ? { name: channel.name, kind: channel.kind } : null
        )
      }
      const resolved = channelCache.get(key)
      channelName = resolved?.name
      channelKind = resolved?.kind
    }

    const isRecurring = startAt !== row.startAt || row.repeat !== undefined
    out.push({
      _id: row._id,
      instanceKey: `${row._id}:${startAt}`,
      title: row.title,
      description: row.description,
      location: row.location,
      startAt,
      endAt,
      allDay: row.allDay ?? false,
      kind: (row.kind ?? 'meeting') as EventKind,
      repeat: (row.repeat ?? 'none') as EventRepeat,
      repeatUntil: row.repeatUntil,
      isRecurring: isRecurring && row.repeat !== undefined,
      reminderMinutes: row.reminderMinutes ?? 0,
      timezone: row.timezone,
      channelId: row.channelId,
      channelName,
      channelKind,
      url: row.url,
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

/** How far ahead `listUpcoming` looks for the next occurrence of a recurring event. */
const UPCOMING_HORIZON = 120 * 24 * 60 * 60 * 1000

/**
 * Events that **overlap** a range — the calendar's only read.
 *
 * A recurring series is one row whose occurrences are **expanded on read**
 * (`expandEventToRange`), so the fetch can't just window on `startAt`: a series that
 * began years ago can still have an occurrence today. We take every series with
 * `startAt <= to` (bounded by `MAX_EVENTS`) and expand each into `[from, to]`. Realistic
 * workspaces never approach the cap; one that does would want an archived-events sweep.
 */
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

    // **Newest-first** (`order('desc')`): the window's events have the LARGEST `startAt`,
    // so at the `MAX_EVENTS` cap we keep the recent ones, not the oldest — ascending would
    // blank the current month for a workspace past the cap. A recurring series whose ORIGIN
    // is older than the cap is the one edge — the documented archived-events limit.
    const rows = await ctx.db
      .query('events')
      .withIndex('by_workspace_start', (q) => q.eq('workspaceId', workspaceId).lte('startAt', to))
      .order('desc')
      .take(MAX_EVENTS)

    const instances = rows.flatMap((row) => expandEventToRange(row, from, to, row.timezone))
    instances.sort((a, b) => a.startAt - b.startAt)
    return await summarize(ctx, instances, workspaceId, user._id)
  }
})

/** The next few events — the header's quick "what's coming up" flyout + the reminder
 *  banner. Expands recurring series into their next occurrences within the horizon. */
export const listUpcoming = query({
  args: { workspaceId: v.id('workspaces'), limit: v.optional(v.number()) },
  handler: async (ctx, { workspaceId, limit }): Promise<EventSummary[]> => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    if (!(await getMembership(ctx, workspaceId, user._id))) return []

    const now = Date.now()
    const to = now + UPCOMING_HORIZON
    const take = Math.min(Math.max(limit ?? 5, 1), 20)
    const rows = await ctx.db
      .query('events')
      .withIndex('by_workspace_start', (q) => q.eq('workspaceId', workspaceId).lte('startAt', to))
      .order('desc')
      .take(MAX_EVENTS)

    // Expand into [now, horizon] — `expandEventToRange` keeps only occurrences still
    // running or ahead — then take the soonest `take`.
    const instances = rows.flatMap((row) => expandEventToRange(row, now, to, row.timezone))
    instances.sort((a, b) => a.startAt - b.startAt)
    return await summarize(ctx, instances.slice(0, take), workspaceId, user._id)
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

    // The detail dialog shows the SERIES (no per-occurrence expansion) — editing a
    // recurring event changes the whole series.
    const [summary] = await summarize(
      ctx,
      [{ event, startAt: event.startAt, endAt: event.endAt }],
      event.workspaceId,
      user._id
    )
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
    /** A voice channel to meet in — mutually exclusive with `url`. */
    channelId: v.optional(v.id('channels')),
    /** An external meeting link — mutually exclusive with `channelId`. */
    url: v.optional(v.string()),
    kind: v.optional(eventKind),
    repeat: v.optional(eventRepeat),
    repeatUntil: v.optional(v.number()),
    reminderMinutes: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    if (!(await getMembership(ctx, args.workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    validate(args)

    // A meeting has one place: a voice channel OR an external link, never both.
    const channelId = args.channelId
      ? await resolveVoiceChannel(ctx, args.workspaceId, args.channelId)
      : undefined
    const url = channelId ? undefined : normalizeUrl(args.url)

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
      channelId,
      url,
      kind: args.kind,
      ...normalizeRepeat(args.repeat, args.repeatUntil, args.startAt),
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
    // Clearable fields take `null` to clear vs an absent key to leave unchanged —
    // the "where" of an event genuinely changes (a link becomes a voice channel, a
    // location is removed), which a bare `?? existing` merge can never express.
    location: v.optional(v.union(v.string(), v.null())),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    allDay: v.optional(v.boolean()),
    timezone: v.optional(v.string()),
    channelId: v.optional(v.union(v.id('channels'), v.null())),
    url: v.optional(v.union(v.string(), v.null())),
    kind: v.optional(eventKind),
    repeat: v.optional(eventRepeat),
    repeatUntil: v.optional(v.union(v.number(), v.null())),
    reminderMinutes: v.optional(v.union(v.number(), v.null()))
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
      location: args.location === undefined ? event.location : (args.location ?? undefined),
      startAt: args.startAt ?? event.startAt,
      endAt: args.endAt ?? event.endAt
    }
    validate(next)

    // Resolve the where. `null` = clear, a value = set (and clears the other place —
    // a meeting has one place), absent = leave both as they were.
    let channelId = event.channelId
    let url = event.url
    if (args.channelId !== undefined) {
      channelId = args.channelId
        ? await resolveVoiceChannel(ctx, event.workspaceId, args.channelId)
        : undefined
      if (channelId) url = undefined
    }
    if (args.url !== undefined) {
      url = args.url ? normalizeUrl(args.url) : undefined
      if (url) channelId = undefined
    }

    // Recurrence: the dialog sends the whole choice, so compute from args (falling back
    // to the stored value) and re-normalise against the new start.
    const repeatChoice = (args.repeat ?? event.repeat ?? 'none') as EventRepeat
    const untilChoice =
      args.repeatUntil === undefined ? event.repeatUntil : (args.repeatUntil ?? undefined)

    await ctx.db.patch(args.eventId, {
      title: next.title.trim(),
      description: next.description?.trim() || undefined,
      location: next.location?.trim() || undefined,
      startAt: next.startAt,
      endAt: next.endAt,
      allDay: args.allDay ?? event.allDay,
      timezone: args.timezone ?? event.timezone,
      channelId,
      url,
      kind: args.kind ?? event.kind,
      ...normalizeRepeat(repeatChoice, untilChoice, next.startAt),
      reminderMinutes: clampReminder(
        args.reminderMinutes === undefined
          ? event.reminderMinutes
          : (args.reminderMinutes ?? undefined)
      ),
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
