import { ConvexError, v } from 'convex/values'
import { query, mutation, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import {
  getChannelAccess,
  getCurrentUser,
  getMembership,
  getSharedChannelsInto,
  requireUser
} from './lib/auth'
import { internal } from './_generated/api'
import { DEFAULT_CHANNEL } from './lib/demoSeed'
import { seedBoardColumns } from './lib/boardSeed'

/** A `groupId` must belong to the same workspace as the channel it's attached to.
 *  Nothing else re-checks this: `groups.remove` only re-parents channels whose
 *  group matches within its own workspace, so a foreign reference would leave the
 *  channel permanently orphaned (its group never appears in the sidebar). */
async function assertGroupInWorkspace(
  ctx: MutationCtx,
  workspaceId: Id<'workspaces'>,
  groupId: Id<'channelGroups'> | undefined
): Promise<void> {
  if (!groupId) return
  const group = await ctx.db.get(groupId)
  if (!group || group.workspaceId !== workspaceId) {
    throw new ConvexError('That group is not in this workspace')
  }
}

const channelKind = v.union(
  v.literal('chat'),
  v.literal('voice'),
  v.literal('page'),
  v.literal('kanban')
)

/** Channels in a workspace (by slug), ordered. Null-safe: [] if not a member. */
export const listBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const workspace = await ctx.db
      .query('workspaces')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!workspace) return []
    if (!(await getMembership(ctx, workspace._id, user._id))) return []
    const channels = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect()
    return channels.sort((a, b) => a.order - b.order)
  }
})

/** A single channel; null if missing or no access. Accepts owner OR guest access
 *  (a shared channel resolves for the guest workspace's members too). */
export const get = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null
    const access = await getChannelAccess(ctx, channelId, user._id)
    return access?.channel ?? null
  }
})

function slugifyChannel(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// URL sub-route prefixes under `/w/<ws>/` — a channel name can't take one, or its
// slug URL (`/w/<ws>/<name>`) would shadow those routes.
const RESERVED_CHANNEL_SLUGS = new Set(['g', 't', 'c'])

/** Make a channel name unique within its workspace so it doubles as the URL slug:
 *  reserve the route prefixes, then auto-suffix (`news` → `news-2`) past any taken
 *  name. `taken` is the set of sibling channel names (exclude the channel itself on
 *  rename). */
function uniqueChannelName(base: string, taken: Set<string>): string {
  const start = RESERVED_CHANNEL_SLUGS.has(base) ? `${base}-channel` : base
  if (!taken.has(start)) return start
  let n = 2
  while (taken.has(`${start}-${n}`)) n++
  return `${start}-${n}`
}

/** Create a channel in a workspace (member-only), optionally within a group. */
export const create = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    groupId: v.optional(v.id('channelGroups')),
    name: v.string(),
    kind: channelKind
  },
  handler: async (ctx, { workspaceId, groupId, name, kind }) => {
    const user = await requireUser(ctx)
    if (!(await getMembership(ctx, workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    const clean = slugifyChannel(name)
    if (!clean) throw new ConvexError('Channel name is required')
    await assertGroupInWorkspace(ctx, workspaceId, groupId)
    const existing = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    const uniqueName = uniqueChannelName(clean, new Set(existing.map((c) => c.name)))
    const channelId = await ctx.db.insert('channels', {
      workspaceId,
      groupId,
      name: uniqueName,
      kind,
      order: existing.length,
      createdBy: user._id
    })
    // A board opens with the default columns rather than a blank canvas.
    // (`page` channels need no seeding — the editor just opens empty.)
    if (kind === 'kanban') {
      await seedBoardColumns(ctx, { workspaceId, channelId, userId: user._id })
    }
    return channelId
  }
})

/** Backfill for workspaces created before the home channel existed — idempotent,
 *  owner/admin only, and a no-op once the flag is set.
 *
 *  Adopts an existing ungrouped `chat` channel named `general` if there is one
 *  (so nobody loses their history), otherwise creates it. The sidebar calls this
 *  once for an owner who lands on a workspace that has no default channel. */
export const ensureDefault = mutation({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await requireUser(ctx)
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can set the default channel')
    }

    const channels = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    const existing = channels.find((channel) => channel.isDefault)
    if (existing) return existing._id

    const adopt = channels.find(
      (channel) => channel.kind === 'chat' && !channel.groupId && channel.name === 'general'
    )
    if (adopt) {
      await ctx.db.patch(adopt._id, { isDefault: true, order: DEFAULT_CHANNEL.order })
      return adopt._id
    }

    return await ctx.db.insert('channels', {
      workspaceId,
      ...DEFAULT_CHANNEL,
      isDefault: true,
      createdBy: user._id
    })
  }
})

/** Rename a channel (member-only). */
export const rename = mutation({
  args: { channelId: v.id('channels'), name: v.string() },
  handler: async (ctx, { channelId, name }) => {
    const user = await requireUser(ctx)
    const channel = await ctx.db.get(channelId)
    if (!channel) throw new ConvexError('Channel not found')
    if (!(await getMembership(ctx, channel.workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    const clean = slugifyChannel(name)
    if (!clean) throw new ConvexError('Channel name is required')
    const siblings = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', channel.workspaceId))
      .collect()
    const uniqueName = uniqueChannelName(
      clean,
      new Set(siblings.filter((c) => c._id !== channelId).map((c) => c.name))
    )
    await ctx.db.patch(channelId, { name: uniqueName })
  }
})

/** Resolve a channel from its slug URL — `channelSlug` is the channel's (unique)
 *  name, `workspaceSlug` the workspace. Matches an owned channel first, else one
 *  shared INTO the workspace (a guest opening a shared channel by its slug). The
 *  `/g/<group>/` segment in the URL is cosmetic and not consulted here. Null-safe. */
export const resolveBySlug = query({
  args: { workspaceSlug: v.string(), channelSlug: v.string() },
  handler: async (ctx, { workspaceSlug, channelSlug }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null
    const workspace = await ctx.db
      .query('workspaces')
      .withIndex('by_slug', (q) => q.eq('slug', workspaceSlug))
      .unique()
    if (!workspace) return null

    const owned = await ctx.db
      .query('channels')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspace._id))
      .collect()
    const match =
      owned.find((c) => c.name === channelSlug) ??
      (await getSharedChannelsInto(ctx, workspace._id)).find((c) => c.name === channelSlug)
    if (!match) return null

    const access = await getChannelAccess(ctx, match._id, user._id)
    return access ? access.channel : null
  }
})

/** The home channel is renameable but never moved or deleted — the UI hides both
 *  affordances, and this is the guarantee behind that. */
const DEFAULT_CHANNEL_LOCKED = "The workspace's default channel can't be moved or deleted"

/** Move a channel to a group (or ungrouped) and/or set its order — for the
 *  context-menu "Move to" action. */
export const move = mutation({
  args: {
    channelId: v.id('channels'),
    groupId: v.optional(v.id('channelGroups')),
    order: v.number()
  },
  handler: async (ctx, { channelId, groupId, order }) => {
    const user = await requireUser(ctx)
    const channel = await ctx.db.get(channelId)
    if (!channel) throw new ConvexError('Channel not found')
    if (!(await getMembership(ctx, channel.workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    if (channel.isDefault) throw new ConvexError(DEFAULT_CHANNEL_LOCKED)
    await assertGroupInWorkspace(ctx, channel.workspaceId, groupId)
    await ctx.db.patch(channelId, { groupId, order })
  }
})

/** Batch reorder for the DnD sidebar (mirrors _zinx's `reorder`, adapted to our
 *  order-number storage): applies the new group order + each bucket's channel
 *  order/membership in one call. `buckets` includes an ungrouped bucket
 *  (`groupId` undefined). Everything is scoped to the workspace (member-only). */
export const reorder = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    groupOrder: v.array(v.id('channelGroups')),
    buckets: v.array(
      v.object({
        groupId: v.optional(v.id('channelGroups')),
        channelIds: v.array(v.id('channels'))
      })
    )
  },
  handler: async (ctx, { workspaceId, groupOrder, buckets }) => {
    const user = await requireUser(ctx)
    if (!(await getMembership(ctx, workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    // Group ordering.
    for (let i = 0; i < groupOrder.length; i++) {
      const group = await ctx.db.get(groupOrder[i])
      if (group && group.workspaceId === workspaceId)
        await ctx.db.patch(groupOrder[i], { order: i })
    }
    // Channel membership + ordering per bucket. The sidebar renders the default
    // channel outside the DnD tree, so it should never appear here — reject it
    // rather than let a stale client dislodge the workspace's landing target.
    for (const bucket of buckets) {
      await assertGroupInWorkspace(ctx, workspaceId, bucket.groupId)
      for (let i = 0; i < bucket.channelIds.length; i++) {
        const channel = await ctx.db.get(bucket.channelIds[i])
        if (channel && channel.workspaceId === workspaceId) {
          if (channel.isDefault) throw new ConvexError(DEFAULT_CHANNEL_LOCKED)
          await ctx.db.patch(bucket.channelIds[i], { groupId: bucket.groupId, order: i })
        }
      }
    }
  }
})

/** Delete a channel (member-only). Removes the channel row now — so it vanishes
 *  from the sidebar immediately — and schedules `cleanup.channel` to drain its
 *  messages/threads/reactions/reads/notifications/kanban/page in bounded batches
 *  (they can far exceed a single mutation's document limit). */
export const remove = mutation({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await requireUser(ctx)
    const channel = await ctx.db.get(channelId)
    if (!channel) return
    if (!(await getMembership(ctx, channel.workspaceId, user._id))) {
      throw new ConvexError('Not a member of this workspace')
    }
    if (channel.isDefault) throw new ConvexError(DEFAULT_CHANNEL_LOCKED)
    await ctx.db.delete(channelId)
    await ctx.scheduler.runAfter(0, internal.cleanup.channel, { channelId })
  }
})
