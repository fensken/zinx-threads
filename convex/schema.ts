import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// Auth + workspace identity model — the minimum the app needs to gate on auth and
// route users to their workspace(s). The full chat domain (channels, messages,
// threads, pages, kanban) is still mock (`src/renderer/src/data/workspaces.ts`)
// and gets ported table-by-table later.
//
// Provider-agnostic on purpose (WorkOS AuthKit today): `users.externalId` +
// `provider` bridge the IdP JWT subject to our row; `workspaces.organizationId`
// is set when a workspace is backed by a WorkOS Organization (enterprise SSO).

/** The workspace ladder. Fixed and small, on purpose — this is Slack's model, not
 *  Discord's: there are no custom roles and no permission catalogue. Roles govern
 *  WORKSPACE actions (invite, manage, moderate); CONTENT access is decided by channel
 *  membership (`channelMembers`), which is a different question and a different table.
 *
 *  `guest` is the new rung: a guest sees ONLY the channels they've been explicitly added
 *  to. That needs no machinery of its own — `getChannelAccess` treats "caller is a guest"
 *  exactly like "channel is private", so one condition buys both features. */
export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const

/** Kanban task priority, mirroring the mock's `TaskPriority`. */
export const taskPriority = v.union(
  v.literal('lowest'),
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('highest')
)

export default defineSchema({
  users: defineTable({
    externalId: v.string(), // WorkOS user id (JWT subject)
    /** `${issuer}|${subject}` — Convex's canonical identity key. The Convex
     *  guidelines are explicit that `subject` alone must not be a global identity
     *  key: two issuers could mint the same subject. Optional only so rows
     *  written before this field existed still load; `store` backfills it on the
     *  next sign-in. */
    tokenIdentifier: v.optional(v.string()),
    provider: v.string(), // "workos"
    email: v.string(), // lowercased
    /** True only when the address came from a JWT claim rather than the client.
     *  WorkOS access tokens carry no `email` claim today, so this is normally
     *  false — see the note on `users.store`. Never treat an unverified email as
     *  proof of ownership. */
    emailVerified: v.optional(v.boolean()),
    name: v.optional(v.string()),
    /** The resolved image URL shown everywhere — a Google/WorkOS photo, or the
     *  public URL of an R2 upload (see `avatarKey`). */
    avatarUrl: v.optional(v.string()),
    /** The R2 object key when the avatar is a user upload (`convex/files.ts`).
     *  Kept alongside `avatarUrl` so a re-upload can delete the previous object;
     *  absent when the avatar is an external photo or unset. */
    avatarKey: v.optional(v.string()),
    color: v.optional(v.string()), // avatar fallback color
    // Presence + custom status (Discord/Slack-style). `presence` unset = online.
    presence: v.optional(
      v.union(v.literal('online'), v.literal('away'), v.literal('dnd'), v.literal('invisible'))
    ),
    statusEmoji: v.optional(v.string()),
    statusText: v.optional(v.string()),
    /** IANA zone (`America/New_York`), detected from the browser on sign-in and
     *  editable in settings. It is what lets one person see another's **local
     *  time** ("8:51 PM local time" on the profile card, Slack-style) — you can't
     *  derive that from a timestamp, only from where they are. Absent for rows
     *  written before this existed; every reader treats that as "unknown". */
    timezone: v.optional(v.string())
  })
    .index('by_external_id', ['externalId'])
    .index('by_token_identifier', ['tokenIdentifier'])
    .index('by_email', ['email']),

  // Tracks a freshly-uploaded R2 object until it's **referenced** (attached to a
  // message, adopted as an avatar/logo). Written by the R2 `onUpload` callback,
  // deleted the moment the key is used (`markUploadUsed`) or the user removes it
  // from the composer (`files.deleteUpload`). Whatever's left is an orphan — an
  // upload that was never attached (the user closed the tab, navigated away) —
  // and the daily cron (`crons.ts` → `files.sweepOrphanUploads`) sweeps it, so we
  // don't pay R2 for files nobody kept.
  uploads: defineTable({
    key: v.string(),
    userId: v.id('users'),
    createdAt: v.number()
  })
    .index('by_key', ['key'])
    .index('by_created', ['createdAt']),

  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerId: v.id('users'),
    inviteCode: v.string(), // shareable code used to join
    icon: v.optional(v.string()), // emoji or short label
    color: v.optional(v.string()),
    /** Uploaded logo (R2 — `convex/files.ts`). Takes precedence over `icon` when
     *  set: a workspace with both a logo and an icon shows the **logo**. `imageKey`
     *  is the R2 object, kept so a replace can delete the previous one. */
    imageUrl: v.optional(v.string()),
    imageKey: v.optional(v.string()),
    /** The workspace's own IANA zone — the team's "office hours" clock. An event is
     *  **authored** in it ("the standup is at 9am" means 9am *here*), while every
     *  reader still sees their own local time beside it. Set at creation (defaulted
     *  from the creator's browser) and editable by an owner/admin. */
    timezone: v.optional(v.string()),
    organizationId: v.optional(v.string()) // WorkOS Organization id (enterprise)
  }).index('by_slug', ['slug']),

  workspaceMembers: defineTable({
    workspaceId: v.id('workspaces'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member'), v.literal('guest')),
    // Per-workspace display name (Discord "server nickname" / Slack workspace
    // display name). Overrides the account's global name inside this workspace;
    // unset → fall back to `users.name`.
    displayName: v.optional(v.string()),
    joinedAt: v.number()
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_user', ['userId'])
    .index('by_workspace_user', ['workspaceId', 'userId'])
    // `@admins` pings the moderators, who are a handful of people in a roster that can
    // run to thousands. Without this, resolving it meant reading every member.
    .index('by_workspace_role', ['workspaceId', 'role']),

  // Workspace invite LINKS (Discord-style): a reusable shareable link, NOT a
  // one-time code. Anyone who opens the link joins — optionally restricted to a
  // whitelist of emails, and optionally expiring. No email is sent; the inviter
  // copies the link and shares it however they like.
  workspaceInvitations: defineTable({
    workspaceId: v.id('workspaces'),
    email: v.optional(v.string()), // legacy single-email note (unused by new links)
    invitedBy: v.id('users'),
    role: v.union(v.literal('admin'), v.literal('member')),
    // 'pending' = the link is ACTIVE (reusable — never flips to 'accepted' now);
    // 'revoked' = disabled. ('accepted' kept only for legacy single-use rows.)
    status: v.union(v.literal('pending'), v.literal('accepted'), v.literal('revoked')),
    /** The secret in the link — a **capability**. Whoever holds it may join
     *  (subject to `allowedEmails` / `expiresAt`). ~120 bits. */
    token: v.optional(v.string()),
    /** Absent = the link never expires (permanent). Otherwise epoch-ms after which
     *  it stops working. */
    expiresAt: v.optional(v.number()),
    /** Absent/empty = open to anyone with the link. Otherwise only these
     *  (lowercased) emails may join through it. */
    allowedEmails: v.optional(v.array(v.string())),
    createdAt: v.number()
  })
    .index('by_email', ['email'])
    .index('by_token', ['token'])
    .index('by_workspace', ['workspaceId'])
    .index('by_workspace_email', ['workspaceId', 'email']),

  // Cross-workspace shared channels (Slack Connect model). A channel lives in its
  // OWNER workspace (`channels.workspaceId`); a `channelShares` row grants a GUEST
  // workspace access to it. One row per (channel, guest workspace) — a channel can
  // be shared with several workspaces, each accepting/leaving independently.
  //
  // The owner workspace is "in charge": only its owner/admins moderate + add/remove
  // guests; guests can post + manage their own messages + leave. Access is always
  // derived server-side via `lib/auth.ts` `getChannelAccess` (owner membership OR an
  // accepted guest share), never trusted from the client. Both parties are existing
  // workspaces, so acceptance is gated by "are you the guest workspace's owner" — no
  // capability token needed (email, when sent, is just a heads-up to that owner).
  channelShares: defineTable({
    channelId: v.id('channels'),
    /** = `channels.workspaceId` (the owner), denormalised so a guest-side query
     *  doesn't have to load every channel to find the home workspace. */
    ownerWorkspaceId: v.id('workspaces'),
    guestWorkspaceId: v.id('workspaces'),
    status: v.union(v.literal('pending'), v.literal('accepted')),
    /** Who in the owner workspace sent the invite. */
    invitedBy: v.id('users'),
    /** The guest owner who accepted (set on accept). */
    acceptedBy: v.optional(v.id('users')),
    /** Secret in the emailed accept link (`/connect/<token>`). Lets the guest owner
     *  accept straight from the email; acceptance is still gated on being that
     *  workspace's owner, so the token is a convenience, not the sole capability. */
    token: v.optional(v.string()),
    createdAt: v.number(),
    acceptedAt: v.optional(v.number())
  })
    .index('by_channel', ['channelId'])
    .index('by_owner_workspace', ['ownerWorkspaceId'])
    .index('by_guest_workspace', ['guestWorkspaceId'])
    // Guest sidebar (accepted) + pending-invite inbox (pending), both without a filter.
    .index('by_guest_status', ['guestWorkspaceId', 'status'])
    // Uniqueness + accept/leave lookups for one (channel, guest) pair.
    .index('by_channel_guest', ['channelId', 'guestWorkspaceId'])
    // Emailed accept-link redemption.
    .index('by_token', ['token']),

  // ── Chat domain (being ported from the mock, chat channels first) ──────────
  // Sidebar categories (Discord-style, one level). Channels reference a group via
  // `channels.groupId`; a channel with no groupId renders ungrouped at the top.
  channelGroups: defineTable({
    workspaceId: v.id('workspaces'),
    name: v.string(),
    order: v.number(),
    createdBy: v.id('users')
  }).index('by_workspace', ['workspaceId']),

  channels: defineTable({
    workspaceId: v.id('workspaces'),
    groupId: v.optional(v.id('channelGroups')),
    // The name is slugified (lowercase-hyphen) + **unique within the workspace**, so it
    // doubles as the URL slug for the slug-based channel routes (`/w/<ws>/<name>` or
    // `/w/<ws>/g/<group>/<name>`). The group segment in the URL is cosmetic (a client
    // slug of the group name); resolution keys on (workspace, name).
    name: v.string(),
    // A **`dm`** is a channel too (Slack models DMs as a channel type, and so do we):
    // it reuses messages, reactions, attachments, reads and notifications wholesale
    // rather than duplicating all of it against a second table. It differs in three
    // ways: it's never in the sidebar's channel list, its membership is the
    // `dmMembers` rows (NOT workspace membership — `getChannelAccess` checks that
    // first, or every member could read every DM), and its `name` is internal.
    kind: v.union(
      v.literal('chat'),
      v.literal('voice'),
      v.literal('page'),
      v.literal('kanban'),
      v.literal('whiteboard'),
      v.literal('dm')
    ),
    /** DM only: the participant ids, deduped + sorted + joined. It's what makes a
     *  conversation between the same people resolve to the SAME channel instead of
     *  spawning a new one each time you click "message" — `dms.open` looks it up on
     *  `by_workspace_dm_key` and reuses the row. The channel's `name` is derived from
     *  it, which also keeps the workspace-unique-name invariant true for DMs without
     *  a special case. Neither is ever displayed. */
    dmKey: v.optional(v.string()),
    topic: v.optional(v.string()),
    emoji: v.optional(v.string()),
    /** Who can SEE this channel.
     *
     *  - `public` (or absent — so no backfill) → every workspace member, as before.
     *  - `private` → only the people in `channelMembers`. **Including admins**: an admin
     *    who isn't in a private channel gets nothing at all, which is Slack's rule and the
     *    whole point of a private channel. (The workspace *owner* may still delete one —
     *    see `channels.remove` — because a channel whose last member left would otherwise
     *    be unreachable AND undeletable. They still can't read it.)
     *
     *  Deliberately a two-state visibility, NOT a rank ladder (`_zinx` uses
     *  `public < members < mods < admins < owner`). A rank can express "admins only"; it
     *  **cannot express identity** — "these five people" is not a rank, and a team chat app
     *  is made of exactly that. See `lib/auth.ts` `getChannelAccess`. */
    visibility: v.optional(v.union(v.literal('public'), v.literal('private'))),
    /** Who can POST here. **Reading and writing are separate questions** — a channel can be
     *  fully visible and still read-only for most people.
     *
     *  - `everyone` (or absent) → anyone with access can post.
     *  - `admins` → an announcement channel: everyone reads, only owner/admins write.
     *  - `selected` → **specific people talk, everyone else just views.** The talkers are
     *    the `channelMembers` rows whose `canPost` isn't false. This is Slack's "restrict
     *    posting to specific people", and it's the reason posting rights live on the
     *    membership row rather than being derivable from a role: "who may speak here" is a
     *    per-person, per-channel fact, and no ladder can express it.
     *
     *  Owner/admins can always post, whatever the policy — they can change the setting in
     *  one click, so locking them out would be theatre. */
    postingPolicy: v.optional(
      v.union(v.literal('everyone'), v.literal('admins'), v.literal('selected'))
    ),
    order: v.number(),
    createdBy: v.id('users'),
    /** The workspace's home channel: an ungrouped `chat` channel seeded at
     *  creation. It can be **renamed but not moved or deleted**, so opening a
     *  workspace always has somewhere to land. Exactly one per workspace. */
    isDefault: v.optional(v.boolean()),
    /** **Legacy — read as a fallback, never written.** The newest-message watermark
     *  moved to its own `channelActivity` row: keeping it here made `channels` a hot
     *  table, and every message invalidated the six always-mounted subscriptions that
     *  read channel documents. See `lib/activity.ts`. */
    lastMessageAt: v.optional(v.number())
  })
    .index('by_workspace', ['workspaceId'])
    // **DMs are channels, and they outnumber real channels without bound** — one row
    // per conversation pair, so a 500-person workspace accumulates thousands. Every
    // workspace-wide read (`listBySlug`, `resolveBySlug`, unread, the name-uniqueness
    // check) used to `.collect()` the `by_workspace` index and drop the DMs in JS —
    // reading thousands of documents nobody is even allowed to see, on a query that
    // re-runs for every connected member on every message. This index lets those reads
    // ask for the kinds they actually want (`lib/channels.ts` `listRealChannels`).
    .index('by_workspace_kind', ['workspaceId', 'kind'])
    .index('by_workspace_dm_key', ['workspaceId', 'dmKey']),

  // The newest-message watermark, one row per channel — see `lib/activity.ts` for
  // why it is NOT a field on `channels`. Only unread + the DM list read it, so only
  // they re-run when a message lands.
  channelActivity: defineTable({
    channelId: v.id('channels'),
    workspaceId: v.id('workspaces'),
    /** `createdAt` of the newest **channel** message. Thread replies are excluded —
     *  a reply inside a thread doesn't bold its parent channel, here or in
     *  Slack/Discord. Never decremented, so deleting the newest message leaves it
     *  stale-high: that costs one bounded scan that finds nothing, not a wrong
     *  answer (the count is decided from the rows, not the watermark). */
    lastMessageAt: v.number()
  })
    .index('by_channel', ['channelId'])
    .index('by_workspace', ['workspaceId']),

  // Who is in a DM. This is the DM's membership — `getChannelAccess` checks it
  // INSTEAD of workspace membership for a `dm` channel, so being in the workspace
  // grants you nothing here. Two people, or up to `MAX_DM_MEMBERS` for a group DM.
  //
  // A separate table rather than an array on the channel because the load-bearing
  // query is "every DM I'm in" — Convex can't index array membership, so a
  // `participantIds` array would mean scanning every DM in the workspace.
  dmMembers: defineTable({
    channelId: v.id('channels'),
    /** Denormalised: DMs live inside one workspace, and the sidebar asks for
     *  "my DMs in THIS workspace" in a single indexed read. */
    workspaceId: v.id('workspaces'),
    userId: v.id('users'),
    createdAt: v.number()
  })
    .index('by_user_workspace', ['userId', 'workspaceId'])
    .index('by_channel', ['channelId'])
    .index('by_channel_user', ['channelId', 'userId']),

  // Who is in a PRIVATE channel — and, for a `guest`, who is in any channel at all.
  //
  // Deliberately the same shape as `dmMembers`, because it does the same job: content
  // access is decided by MEMBERSHIP, not by role. That's the Slack model, and it's the one
  // thing a rank ladder structurally cannot express — "these five people" is not a rank.
  //
  // A separate table rather than an array on the channel, for the same reason DMs got one:
  // Convex can't index array membership, and "every private channel I'm in" is the
  // load-bearing query (the sidebar runs it on every render).
  channelMembers: defineTable({
    channelId: v.id('channels'),
    /** Denormalised, exactly as on `dmMembers`: the sidebar asks "my private channels in
     *  THIS workspace" in one indexed read. */
    workspaceId: v.id('workspaces'),
    userId: v.id('users'),
    /** Who added them — shown in the channel's member list ("added by Alice"). */
    addedBy: v.id('users'),
    addedAt: v.number(),
    /** May this person POST here? Absent = yes.
     *
     *  Only consulted when `channels.postingPolicy === 'selected'` — the "specific people
     *  can talk, everyone else views" mode. It sits on the membership row because that is
     *  what it *is*: a fact about one person in one channel. A role can't say it (two
     *  members of the same channel can differ), and a channel-level flag can't either.
     *
     *  In a PRIVATE channel this makes a read-only participant: they see everything and can
     *  say nothing. In a PUBLIC one, a row exists only for the people allowed to speak —
     *  everyone else still reads it, because it's public. */
    canPost: v.optional(v.boolean())
  })
    .index('by_user_workspace', ['userId', 'workspaceId'])
    .index('by_channel', ['channelId'])
    .index('by_channel_user', ['channelId', 'userId']),

  // How far each member has read each channel. One row per (user, channel), and
  // only for channels they've opened — a missing row means "never read", which is
  // the same as `lastReadAt: 0`.
  channelReads: defineTable({
    userId: v.id('users'),
    /** Denormalised so one indexed query loads every read marker for a workspace. */
    workspaceId: v.id('workspaces'),
    channelId: v.id('channels'),
    /** Messages created at or before this are read. Only ever moves forward. */
    lastReadAt: v.number()
  })
    .index('by_user_workspace', ['userId', 'workspaceId'])
    .index('by_user_channel', ['userId', 'channelId'])
    .index('by_channel', ['channelId'])
    // A guest workspace leaving a shared channel drops its own read markers for it.
    .index('by_channel_workspace', ['channelId', 'workspaceId']),

  // The Inbox: one row per (recipient, message) written at send time — a
  // fan-out, the way Discord/Slack build a notifications feed. Read-time can't do
  // it: "messages that mention me across every channel" isn't indexable (the
  // mention lives in the body text), and scanning every channel is unbounded.
  //
  // `kind` is the strongest reason this message concerns you (mention > reply >
  // thread), so a message that both @-mentions you and replies to you is ONE row.
  // `readAt` is per-notification (the Inbox is cleared independently of the
  // channel's own unread marker — you can read a mention in-channel yet still
  // want it in your inbox history, and vice-versa; matches Slack).
  notifications: defineTable({
    userId: v.id('users'),
    workspaceId: v.id('workspaces'),
    channelId: v.id('channels'),
    messageId: v.id('messages'),
    /** Who caused it (never equal to `userId` — you don't notify yourself). */
    actorId: v.id('users'),
    // `dm` = any message in a direct message. Unlike a channel (where only a
    // mention/reply/thread-reply concerns you), a DM is addressed to you by
    // definition, so every message in one earns an Inbox row.
    kind: v.union(v.literal('mention'), v.literal('reply'), v.literal('thread'), v.literal('dm')),
    /** The thread the message lives in, so the Inbox can open it in the panel. */
    threadId: v.optional(v.id('threads')),
    createdAt: v.number(),
    /** Set when the user clears it from the Inbox. Absent = unread. */
    readAt: v.optional(v.number())
  })
    // Newest-first per workspace, and unread-only, both without a `.filter()`.
    .index('by_user_workspace_created', ['userId', 'workspaceId', 'createdAt'])
    .index('by_user_workspace_read', ['userId', 'workspaceId', 'readAt'])
    // The Inbox is **the user's**, not a workspace's: it spans every workspace they
    // belong to (that's what "someone messaged me" means — you don't check four
    // inboxes). These are the same two reads, unpinned from a workspace.
    //
    // `by_user_kind_created` is what makes "mentions, last 7 days" one indexed range
    // scan instead of a filter over everything: `kind` sits BEFORE `createdAt`, so an
    // equality on it still leaves the date as the range field.
    .index('by_user_created', ['userId', 'createdAt'])
    .index('by_user_kind_created', ['userId', 'kind', 'createdAt'])
    .index('by_user_read', ['userId', 'readAt'])
    // Cascades: a deleted message / channel drops its notifications.
    .index('by_message', ['messageId'])
    .index('by_channel', ['channelId'])
    // A guest workspace leaving a shared channel drops its notifications for it.
    .index('by_channel_workspace', ['channelId', 'workspaceId'])
    // Removed from a private channel → their inbox rows for it go too. Without this, you'd
    // keep getting notifications for a channel you can no longer open, and clicking one
    // would land on a dead end.
    .index('by_user_channel', ['userId', 'channelId'])
    // Retention sweep: the Inbox is the only unboundedly-growing table (a row per
    // mention/reply/thread, forever). A daily cron prunes rows past a TTL via this.
    .index('by_created', ['createdAt']),

  // A side conversation hanging off one channel message. The **root message stays
  // in the channel** (Slack/Discord); only the replies live in the thread. No
  // nesting — you can't start a thread from a thread reply.
  //
  // `replyCount` / `lastReplyAt` / `participantIds` are denormalised so the
  // channel's thread indicator and the Threads flyout render without a fan-out
  // read per thread. `participantIds` is capped (see `THREAD_PARTICIPANT_CAP`).
  threads: defineTable({
    workspaceId: v.id('workspaces'),
    channelId: v.id('channels'),
    rootMessageId: v.id('messages'),
    name: v.string(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    replyCount: v.number(),
    /** Falls back to `createdAt` while the thread has no replies. */
    lastReplyAt: v.number(),
    participantIds: v.array(v.id('users'))
  })
    .index('by_channel', ['channelId'])
    .index('by_workspace_last_reply', ['workspaceId', 'lastReplyAt']),

  messages: defineTable({
    channelId: v.id('channels'),
    workspaceId: v.id('workspaces'),
    authorId: v.id('users'),
    body: v.string(), // Markdown (see `lib/tiptap-markdown.ts`)
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    /** Inline reply (Discord-style quote), NOT a thread. */
    replyToId: v.optional(v.id('messages')),
    pinned: v.optional(v.boolean()),
    /** Set on a **reply inside** a thread. Absent on ordinary channel messages. */
    threadId: v.optional(v.id('threads')),
    /** Set on the channel message a thread was **started from** (its root). */
    threadRootId: v.optional(v.id('threads')),
    /** Client-generated id (Discord calls it a nonce). Makes `send` idempotent:
     *  the durable outbox replays unsent messages after an app quit, and a send
     *  that committed but whose ack never arrived must not post twice. */
    clientId: v.optional(v.string()),
    /** Uploaded files (R2 — `convex/files.ts`). A capped array on the message,
     *  edited as a unit; the `url` is resolved from the object `key` at send time
     *  so the renderer needs no signing. Absent on a plain text message. */
    attachments: v.optional(
      v.array(
        v.object({
          key: v.string(),
          url: v.string(),
          name: v.string(),
          contentType: v.string(),
          size: v.number()
        })
      )
    ),
    /** Denormalised reaction summary — the exact shape the message list renders,
     *  minus the viewer-relative `reacted` flag (derived from `userIds`).
     *
     *  `messageReactions` remains the source of truth (it's what enforces one
     *  reaction per user per emoji); this is a cache maintained by `toggleReaction`.
     *  Without it, rendering a page of messages meant **one index range per message**
     *  — 50+ ranges on the single hottest query in the app, re-run for every viewer
     *  of a channel on every message, and almost all of them empty. Reactions are
     *  read constantly and written rarely, which is exactly when denormalising wins.
     *
     *  Bounded: `MAX_UNIQUE_REACTIONS` emoji, each sampling up to `REACTOR_SAMPLE`
     *  user ids (`count` stays exact past the sample; a viewer outside a truncated
     *  sample costs one indexed lookup). Absent on messages written before this — see
     *  `lib/messages.ts`, which falls back to reading the rows. */
    reactions: v.optional(
      v.array(
        v.object({
          emoji: v.string(),
          count: v.number(),
          userIds: v.array(v.id('users'))
        })
      )
    )
  })
    .index('by_channel', ['channelId'])
    .index('by_client_id', ['clientId'])
    // The channel's own message list. `threadId` sits in the middle so the query
    // can pin it to `undefined` and exclude thread replies — Convex indexes match
    // on optional fields, and our rules forbid `.filter()` on a query builder.
    .index('by_channel_thread_created', ['channelId', 'threadId', 'createdAt'])
    .index('by_thread_created', ['threadId', 'createdAt'])
    // Lets `listPinned` read a channel's pins directly instead of scanning it.
    // `threadId` is pinned to `undefined` for the same reason as above: a pinned
    // *thread reply* is not in the channel's message list, so listing it in the
    // channel's pinned dialog would hand the reader a message they can't jump to.
    .index('by_channel_thread_pinned', ['channelId', 'threadId', 'pinned'])
    // Full-text search over message bodies, scoped per workspace (the caller is a
    // member of the whole workspace, so this is the right authorization boundary).
    // `threadId` is a filter field so search can exclude thread replies.
    .searchIndex('search_body', {
      searchField: 'body',
      filterFields: ['workspaceId', 'threadId']
    }),

  // The document behind a `kind: 'page'` channel — one row per channel, created
  // on first save. `content` is the BlockNote document serialized to JSON rather
  // than modelled as Convex validators: the block shapes are BlockNote's, they
  // change with its version, and nothing server-side reads inside them.
  //
  // Last-write-wins. Real multiplayer editing would need a CRDT (y.js) and is a
  // separate project; today two people editing one page will clobber each other.
  pages: defineTable({
    workspaceId: v.id('workspaces'),
    channelId: v.id('channels'),
    title: v.string(),
    icon: v.optional(v.string()), // emoji
    cover: v.optional(v.string()), // `gradient:<key>` | `color:<hex>` | image URL
    /** R2 object key when the cover is a user **upload** (`convex/files.ts`), so a
     *  replace can delete the previous object. Absent for gradient/color/Unsplash/
     *  link covers. */
    coverKey: v.optional(v.string()),
    coverY: v.optional(v.number()), // vertical focal point, 0–100
    content: v.string(), // JSON: BlockNote `Block[]`
    updatedAt: v.number(),
    updatedBy: v.id('users')
  }).index('by_channel', ['channelId']),

  // The board behind a `kind: 'kanban'` channel. Unlike `pages.content` (an opaque
  // BlockNote blob), a board's tasks are queried and reordered individually, so
  // they get real rows.
  kanbanColumns: defineTable({
    workspaceId: v.id('workspaces'),
    channelId: v.id('channels'),
    title: v.string(),
    order: v.number(),
    createdBy: v.id('users')
  }).index('by_channel', ['channelId']),

  kanbanTasks: defineTable({
    workspaceId: v.id('workspaces'),
    channelId: v.id('channels'), // denormalised: lets one query load a whole board
    columnId: v.id('kanbanColumns'),
    title: v.string(),
    description: v.optional(v.string()), // Markdown
    priority: taskPriority,
    /** Capped arrays, edited as a unit by the task dialog. The rule against
     *  unbounded arrays is about growth; a hard cap keeps the document bounded —
     *  the same call as `threads.participantIds`. See `convex/boards.ts`. */
    assigneeIds: v.array(v.id('users')),
    labels: v.array(v.string()),
    checklist: v.array(v.object({ id: v.string(), content: v.string(), completed: v.boolean() })),
    dueDate: v.optional(v.string()), // ISO `YYYY-MM-DD`
    storyPoints: v.optional(v.number()),
    order: v.number(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index('by_channel', ['channelId'])
    .index('by_column_order', ['columnId', 'order']),

  // One row per (message, user, emoji) — the compound index makes the toggle a
  // single unique lookup (mirrors `_zinx`'s `chatReaction`).
  messageReactions: defineTable({
    messageId: v.id('messages'),
    userId: v.id('users'),
    emoji: v.string()
  })
    .index('by_message', ['messageId'])
    .index('by_message_user_emoji', ['messageId', 'userId', 'emoji']),

  // Who's connected to which voice channel right now (Discord-style avatars under
  // the sidebar voice channels). Client-reported: the caller upserts their row on
  // join + heartbeats it while in the call, deletes it on leave. **One row per
  // user** (upsert by `by_user`), so it never accumulates; a crashed client leaves
  // one stale row that `updatedAt` (TTL-filtered by `listByWorkspace`) treats as
  // gone and the next join overwrites. See `convex/voice.ts`.
  voicePresence: defineTable({
    userId: v.id('users'),
    workspaceId: v.id('workspaces'),
    channelId: v.id('channels'),
    // In-call status, shown as icons in the sidebar (Discord-style). Reported
    // alongside the heartbeat + immediately on change.
    muted: v.optional(v.boolean()),
    deafened: v.optional(v.boolean()),
    videoOn: v.optional(v.boolean()),
    screenSharing: v.optional(v.boolean()),
    updatedAt: v.number()
  })
    .index('by_user', ['userId'])
    .index('by_workspace', ['workspaceId'])
    .index('by_channel', ['channelId']),

  // Calendar events.
  //
  // **Every instant is a UTC epoch-ms number** (`startAt`/`endAt`) — a wall-clock
  // string is never stored. `timezone` records the zone the event was *authored* in
  // (the workspace's), which is a different thing and is needed twice over: to say
  // "9:00 AM, workspace time" honestly, and because recurrence (when it lands)
  // recurs in a zone, not in UTC — "every weekday at 9" has to survive a DST shift.
  //
  // **Sync-ready by construction.** Google Calendar and CalDAV/Apple both exchange
  // exactly this shape — an instant, a zone, an opaque id and a change token — so the
  // `external*` fields are the entire hook a sync needs: which provider an event came
  // from, its id there, and the etag we last saw (which is what lets a sync decide who
  // won a conflict). Absent on an in-app event; no migration when sync arrives.
  events: defineTable({
    workspaceId: v.id('workspaces'),
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    /** UTC epoch ms. `endAt >= startAt` is enforced in `events.ts`. */
    startAt: v.number(),
    endAt: v.number(),
    /** An all-day event has no meaningful clock — it names a *date*, and must not
     *  slide by a day when read from another zone. `startAt` is midnight in
     *  `timezone`, and readers render it in THAT zone rather than their own. */
    allDay: v.optional(v.boolean()),
    /** The IANA zone the event was authored in (the workspace's). */
    timezone: v.string(),
    /** Optionally tied to a channel — "the #design sync". */
    channelId: v.optional(v.id('channels')),
    /** Minutes before `startAt` to remind attendees. Absent (or 0) = no reminder.
     *  The reminder is **derived, not scheduled**: the app surfaces an event once
     *  `now >= startAt - reminderMinutes` (see `events.listUpcoming` + the header
     *  banner). Nothing is queued, so changing the time or deleting the event can't
     *  leave a stale job behind — the price is that a reminder only fires while the
     *  app is open, which is honest for an in-app banner. Push/email reminders would
     *  need `ctx.scheduler` and a `scheduledReminders` job list (as zinx-os does). */
    reminderMinutes: v.optional(v.number()),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
    // ── Future calendar sync (Google / Apple / CalDAV). Absent = an in-app event.
    externalProvider: v.optional(v.string()), // 'google' | 'apple' | …
    externalId: v.optional(v.string()), // the event's id in that provider
    externalEtag: v.optional(v.string()) // last-seen change token, for conflict checks
  })
    // The calendar asks one question — "what's in this range?" — and this answers it
    // as an index range rather than a scan of every event the workspace ever had.
    .index('by_workspace_start', ['workspaceId', 'startAt'])
    .index('by_channel', ['channelId'])
    // A sync reconciles by (provider, their id); indexed so it never scans.
    .index('by_external', ['externalProvider', 'externalId']),

  // `elements` is the Excalidraw element array as a JSON **string** — the same call as
  // `pages.content` (the shapes are Excalidraw's, they change with its version, and
  // nothing server-side reads inside them).
  //
  // The canvas behind a `kind: 'whiteboard'` channel — one row per channel, created on
  // first save, exactly like `pages`.
  //
  // This replaced an Excalidraw *block inside a page*, which was the wrong shape: a
  // drawing had to live as a preview card you clicked to open, because a page autosaves
  // its whole document on every keystroke and an inline scene would be re-uploaded with
  // every word typed. A channel has no such constraint — the canvas IS the content, it
  // saves on its own schedule, and there is no card, no PNG snapshot, and no modal.
  whiteboards: defineTable({
    workspaceId: v.id('workspaces'),
    channelId: v.id('channels'),
    /** JSON array of Excalidraw elements. Parsed defensively on the client: a corrupt
     *  scene opens as an empty canvas rather than taking the channel down. */
    elements: v.string(),
    /** Cheap "N shapes" for the UI without parsing the scene to count. */
    elementCount: v.number(),
    updatedBy: v.id('users'),
    updatedAt: v.number()
  }).index('by_channel', ['channelId']),

  // Who's coming. A row per (event, user) rather than an array on the event: RSVPs
  // are written one at a time, by different people, and the list grows.
  eventAttendees: defineTable({
    eventId: v.id('events'),
    /** Denormalised so "my RSVPs in this workspace" is one indexed read. */
    workspaceId: v.id('workspaces'),
    userId: v.id('users'),
    status: v.union(
      v.literal('going'),
      v.literal('maybe'),
      v.literal('declined'),
      v.literal('invited')
    ),
    updatedAt: v.number()
  })
    .index('by_event', ['eventId'])
    .index('by_event_user', ['eventId', 'userId'])
    .index('by_user_workspace', ['userId', 'workspaceId']),

  // Personal access tokens for programmatic access — the MCP connector (Claude/ChatGPT
  // drive the app on your behalf) and, later, bots. A token acts AS the user who minted
  // it, so it inherits their exact permissions through `getChannelAccess` — a private
  // channel they can't see stays invisible to their AI.
  //
  // We store only a SHA-256 **hash** of the token, never the token itself (the R2-key
  // lesson: a leaked table must not hand out working credentials). The raw token is shown
  // to the user exactly once, at creation. `by_hash` is the lookup on every API request.
  apiTokens: defineTable({
    userId: v.id('users'),
    /** Hex SHA-256 of the raw token. The only copy we keep. */
    hashedToken: v.string(),
    /** A human label so a user can tell their tokens apart ("Claude", "ChatGPT"). */
    name: v.string(),
    /** First 8 chars of the raw token, shown in the UI so a row is identifiable without
     *  ever storing or displaying the secret itself. */
    preview: v.string(),
    /** Set when this token belongs to a BOT rather than a person — so the personal-token
     *  list excludes it and deleting a bot can find (and revoke) its tokens. A bot token's
     *  `userId` is the bot's own principal, so it acts AS the bot. */
    botId: v.optional(v.id('bots')),
    createdAt: v.number(),
    /** Best-effort; updated lazily, not on every call (a write per request would add
     *  latency + contention to the hot path). */
    lastUsedAt: v.optional(v.number())
  })
    .index('by_hash', ['hashedToken'])
    .index('by_user', ['userId'])
    .index('by_bot', ['botId']),

  // A **bot** is a non-human member of a workspace — a Slack/Discord-style automation
  // principal. It IS a real `users` row (`provider: 'bot'`) with a `workspaceMembers` row,
  // so every existing gate treats it like any member: it appears as an author, is badged as
  // a bot, and can only reach the workspace + channels it's a member of. Its token drives the
  // same API a human connector uses (`resolveMcpUser` → the bot's principal). This table is
  // just the registry that ties the bot's principal to the workspace + who created it.
  bots: defineTable({
    workspaceId: v.id('workspaces'),
    /** The bot's own `users` row (provider `'bot'`) — its identity as an author + member. */
    userId: v.id('users'),
    name: v.string(),
    createdBy: v.id('users'),
    createdAt: v.number()
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_user', ['userId']),

  // Slack-style **incoming webhooks** — a per-bot, per-channel URL that an external service
  // (CI, alerts, GitHub) POSTs to, to post a message into a channel AS the bot. The URL
  // embeds a secret we store only as a hash. This is the highest-adoption bot surface and
  // needs no code on the caller's side beyond an HTTP POST.
  incomingWebhooks: defineTable({
    workspaceId: v.id('workspaces'),
    botId: v.id('bots'),
    channelId: v.id('channels'),
    /** SHA-256 of the URL secret — the only copy. */
    hashedToken: v.string(),
    preview: v.string(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number())
  })
    .index('by_hash', ['hashedToken'])
    .index('by_bot', ['botId'])
    .index('by_channel', ['channelId'])
    .index('by_workspace', ['workspaceId'])
})
