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

export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const

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
    statusText: v.optional(v.string())
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
    organizationId: v.optional(v.string()) // WorkOS Organization id (enterprise)
  }).index('by_slug', ['slug']),

  workspaceMembers: defineTable({
    workspaceId: v.id('workspaces'),
    userId: v.id('users'),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member')),
    // Per-workspace display name (Discord "server nickname" / Slack workspace
    // display name). Overrides the account's global name inside this workspace;
    // unset → fall back to `users.name`.
    displayName: v.optional(v.string()),
    joinedAt: v.number()
  })
    .index('by_workspace', ['workspaceId'])
    .index('by_user', ['userId'])
    .index('by_workspace_user', ['workspaceId', 'userId']),

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
    kind: v.union(v.literal('chat'), v.literal('voice'), v.literal('page'), v.literal('kanban')),
    topic: v.optional(v.string()),
    emoji: v.optional(v.string()),
    private: v.optional(v.boolean()),
    order: v.number(),
    createdBy: v.id('users'),
    /** The workspace's home channel: an ungrouped `chat` channel seeded at
     *  creation. It can be **renamed but not moved or deleted**, so opening a
     *  workspace always has somewhere to land. Exactly one per workspace. */
    isDefault: v.optional(v.boolean()),
    /** `createdAt` of the newest **channel** message. Thread replies are excluded
     *  — a reply inside a thread doesn't bold its parent channel, here or in
     *  Slack/Discord.
     *
     *  Purely a fast path for `unread.listByWorkspace`: a channel whose
     *  `lastMessageAt <= lastReadAt` is provably read and is skipped without
     *  reading a single `messages` row. It is never decremented, so deleting the
     *  newest message leaves it stale-high — which costs one scan that finds
     *  nothing, not a wrong answer. Absent on channels that predate this, so they
     *  start out read rather than retroactively bolding the whole sidebar. */
    lastMessageAt: v.optional(v.number())
  }).index('by_workspace', ['workspaceId']),

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
    kind: v.union(v.literal('mention'), v.literal('reply'), v.literal('thread')),
    /** The thread the message lives in, so the Inbox can open it in the panel. */
    threadId: v.optional(v.id('threads')),
    createdAt: v.number(),
    /** Set when the user clears it from the Inbox. Absent = unread. */
    readAt: v.optional(v.number())
  })
    // Newest-first per workspace, and unread-only, both without a `.filter()`.
    .index('by_user_workspace_created', ['userId', 'workspaceId', 'createdAt'])
    .index('by_user_workspace_read', ['userId', 'workspaceId', 'readAt'])
    // Cascades: a deleted message / channel drops its notifications.
    .index('by_message', ['messageId'])
    .index('by_channel', ['channelId'])
    // A guest workspace leaving a shared channel drops its notifications for it.
    .index('by_channel_workspace', ['channelId', 'workspaceId'])
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
    .index('by_channel', ['channelId'])
})
