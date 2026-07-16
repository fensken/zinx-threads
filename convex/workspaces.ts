import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'
import { rateLimiter } from './rateLimiter'
import { markUploadUsed, objectUrl, r2 } from './files'
import { internal } from './_generated/api'
import { seedBoardColumns } from './lib/boardSeed'
import {
  DEFAULT_CHANNEL,
  DEFAULT_GROUPS,
  DEMO_CHANNELS,
  RESERVED_WORKSPACE_SLUGS
} from './lib/demoSeed'
import type { Doc, Id } from './_generated/dataModel'

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  )
}

/** A valid workspace address: lowercase alphanumerics + single hyphens, 2–40 chars. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Validate + normalise a user-supplied slug, throwing a friendly reason on failure. */
function validateSlug(raw: string): string {
  const slug = raw.trim().toLowerCase()
  if (slug.length < 2 || slug.length > 40) {
    throw new ConvexError('The address must be 2–40 characters')
  }
  if (!SLUG_RE.test(slug)) {
    throw new ConvexError('Use lowercase letters, numbers, and hyphens only')
  }
  if (RESERVED_WORKSPACE_SLUGS.includes(slug)) {
    throw new ConvexError('That address is reserved')
  }
  return slug
}

// Short random code/suffix (Math.random is allowed in Convex mutations).
function randomCode(len: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

async function initials(name: string): Promise<string> {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'W'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

type WorkspaceSummary = { workspace: Doc<'workspaces'>; role: Doc<'workspaceMembers'>['role'] }

/** Workspaces the current user owns or has joined (owned first, then oldest). */
export const myWorkspaces = query({
  args: {},
  handler: async (ctx): Promise<WorkspaceSummary[]> => {
    // Null-safe: on first sign-in the `users` row may not exist yet (storeUser is
    // in flight). Return []; the query re-runs reactively once the row lands.
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const memberships = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()

    const out: WorkspaceSummary[] = []
    for (const m of memberships) {
      const workspace = await ctx.db.get(m.workspaceId)
      if (workspace) out.push({ workspace, role: m.role })
    }
    out.sort((a, b) => {
      if (a.role === 'owner' && b.role !== 'owner') return -1
      if (b.role === 'owner' && a.role !== 'owner') return 1
      return a.workspace._creationTime - b.workspace._creationTime
    })
    return out
  }
})

/** Resolve a workspace by slug for the current user (must be a member). */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null
    const workspace = await ctx.db
      .query('workspaces')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique()
    if (!workspace) return null
    const membership = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace_user', (q) =>
        q.eq('workspaceId', workspace._id).eq('userId', user._id)
      )
      .unique()
    if (!membership) return null
    return { workspace, role: membership.role, displayName: membership.displayName }
  }
})

/** Is a workspace address free to use? Drives the live check in the create dialog +
 *  settings. `reason` distinguishes invalid / reserved / taken for the UI copy. */
export const slugAvailable = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const normalized = slug.trim().toLowerCase()
    if (normalized.length < 2 || normalized.length > 40 || !SLUG_RE.test(normalized)) {
      return { available: false as const, reason: 'invalid' as const }
    }
    if (RESERVED_WORKSPACE_SLUGS.includes(normalized)) {
      return { available: false as const, reason: 'reserved' as const }
    }
    const existing = await ctx.db
      .query('workspaces')
      .withIndex('by_slug', (q) => q.eq('slug', normalized))
      .unique()
    return existing
      ? { available: false as const, reason: 'taken' as const }
      : { available: true as const }
  }
})

/** Create a workspace; the creator becomes its owner. When `slug` is given it must
 *  be free (the dialog advises before submitting); omitted, we derive one and
 *  auto-suffix on collision. */
export const create = mutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    /** The team's clock (IANA). Defaulted from the creator's browser and asked for
     *  at creation, because an event is authored in it — a workspace with no zone
     *  would have to guess, and guessing is what silently shifts a standup by five
     *  hours. */
    timezone: v.optional(v.string())
  },
  handler: async (ctx, { name, slug: rawSlug, timezone }) => {
    const user = await requireUser(ctx)
    await rateLimiter.limit(ctx, 'createWorkspace', { key: user._id, throws: true })
    const trimmed = name.trim()
    if (trimmed.length < 2) throw new ConvexError('Workspace name is too short')

    let slug: string
    if (rawSlug !== undefined) {
      slug = validateSlug(rawSlug)
      const clash = await ctx.db
        .query('workspaces')
        .withIndex('by_slug', (q) => q.eq('slug', slug))
        .unique()
      if (clash) throw new ConvexError('That address is already taken — pick another')
    } else {
      // No explicit slug: derive from the name, add a suffix on collision or a
      // reserved demo slug (so /w/zinx etc. always resolve to the demo).
      slug = slugify(trimmed)
      const clash = await ctx.db
        .query('workspaces')
        .withIndex('by_slug', (q) => q.eq('slug', slug))
        .unique()
      if (clash || RESERVED_WORKSPACE_SLUGS.includes(slug)) slug = `${slug}-${randomCode(4)}`
    }

    const workspaceId: Id<'workspaces'> = await ctx.db.insert('workspaces', {
      name: trimmed,
      slug,
      ownerId: user._id,
      inviteCode: randomCode(8),
      icon: await initials(trimmed),
      timezone
    })
    await ctx.db.insert('workspaceMembers', {
      workspaceId,
      userId: user._id,
      role: 'owner',
      joinedAt: Date.now()
    })

    // Seed the default sidebar groups + channel set so a new workspace has a
    // rich structure — but NO fake teammates or messages: a new real workspace
    // has exactly one member (its owner).

    // The home channel first: ungrouped, protected, always a landing target.
    await ctx.db.insert('channels', {
      workspaceId,
      ...DEFAULT_CHANNEL,
      isDefault: true,
      createdBy: user._id
    })

    const groupIds = new Map<string, Id<'channelGroups'>>()
    for (let i = 0; i < DEFAULT_GROUPS.length; i++) {
      const gid = await ctx.db.insert('channelGroups', {
        workspaceId,
        name: DEFAULT_GROUPS[i],
        order: i,
        createdBy: user._id
      })
      groupIds.set(DEFAULT_GROUPS[i], gid)
    }
    for (let i = 0; i < DEMO_CHANNELS.length; i++) {
      const ch = DEMO_CHANNELS[i]
      const channelId = await ctx.db.insert('channels', {
        workspaceId,
        groupId: groupIds.get(ch.group),
        name: ch.name,
        kind: ch.kind,
        emoji: ch.emoji,
        topic: ch.topic,
        order: i,
        createdBy: user._id
      })
      // Boards open with the default columns, same as `channels.create`.
      if (ch.kind === 'kanban') {
        await seedBoardColumns(ctx, { workspaceId, channelId, userId: user._id })
      }
    }
    return { workspaceId, slug }
  }
})

// Joining is now by email invitation — see `convex/invitations.ts`.

/** Update workspace settings (name / slug / icon / color) — owner or admin. Returns
 *  the effective slug so the client can navigate to the new URL when it changed. */
export const update = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    icon: v.optional(v.string()),
    color: v.optional(v.string()),
    timezone: v.optional(v.string())
  },
  handler: async (ctx, { workspaceId, name, slug, icon, color, timezone }) => {
    const user = await requireUser(ctx)
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can edit workspace settings')
    }
    const workspace = await ctx.db.get(workspaceId)
    if (!workspace) throw new ConvexError('Workspace not found')

    const patch: Partial<Pick<Doc<'workspaces'>, 'name' | 'slug' | 'icon' | 'color' | 'timezone'>> =
      {}
    if (name !== undefined) {
      const trimmed = name.trim()
      if (trimmed.length < 2) throw new ConvexError('Workspace name is too short')
      patch.name = trimmed
    }
    if (slug !== undefined) {
      const normalized = validateSlug(slug)
      if (normalized !== workspace.slug) {
        const clash = await ctx.db
          .query('workspaces')
          .withIndex('by_slug', (q) => q.eq('slug', normalized))
          .unique()
        if (clash) throw new ConvexError('That address is already taken — pick another')
        patch.slug = normalized
      }
    }
    if (icon !== undefined) patch.icon = icon
    if (color !== undefined) patch.color = color
    if (timezone !== undefined) patch.timezone = timezone.trim().slice(0, 64)
    await ctx.db.patch(workspaceId, patch)
    return { slug: patch.slug ?? workspace.slug }
  }
})

/** Set the workspace logo from a freshly-uploaded R2 object — owner/admin. The
 *  logo takes display precedence over the icon (see `WorkspaceGlyph`). Deletes the
 *  previous object so we don't leak storage. */
export const setLogo = mutation({
  args: { workspaceId: v.id('workspaces'), key: v.string() },
  handler: async (ctx, { workspaceId, key }) => {
    const user = await requireUser(ctx)
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can change the workspace logo')
    }
    const workspace = await ctx.db.get(workspaceId)
    if (!workspace) return
    const previousKey = workspace.imageKey
    await markUploadUsed(ctx, user._id, key)
    await ctx.db.patch(workspaceId, { imageKey: key, imageUrl: await objectUrl(key) })
    if (previousKey && previousKey !== key) {
      try {
        await r2.deleteObject(ctx, previousKey)
      } catch {
        // orphaned object, not a user-facing failure
      }
    }
  }
})

/** Remove the workspace logo (reverts to the icon / initials) — owner/admin. */
export const removeLogo = mutation({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await requireUser(ctx)
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can change the workspace logo')
    }
    const workspace = await ctx.db.get(workspaceId)
    if (!workspace?.imageKey) return
    const key = workspace.imageKey
    await ctx.db.patch(workspaceId, { imageKey: undefined, imageUrl: undefined })
    try {
      await r2.deleteObject(ctx, key)
    } catch {
      // see setLogo
    }
  }
})

/** Leave a workspace (non-owners only; the owner must delete or transfer). */
export const leave = mutation({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await requireUser(ctx)
    const workspace = await ctx.db.get(workspaceId)
    if (!workspace) return
    if (workspace.ownerId === user._id) {
      throw new ConvexError('The owner cannot leave — delete the workspace instead')
    }
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (membership) await ctx.db.delete(membership._id)
    // Drop your read markers + inbox for this workspace (your messages stay).
    await ctx.scheduler.runAfter(0, internal.cleanup.member, { workspaceId, userId: user._id })
  }
})

/** Delete a workspace and everything in it — owner only, name-confirmed. */
export const remove = mutation({
  args: { workspaceId: v.id('workspaces'), confirmName: v.string() },
  handler: async (ctx, { workspaceId, confirmName }) => {
    const user = await requireUser(ctx)
    const workspace = await ctx.db.get(workspaceId)
    if (!workspace) return
    if (workspace.ownerId !== user._id) {
      throw new ConvexError('Only the owner can delete a workspace')
    }
    if (confirmName.trim() !== workspace.name) {
      throw new ConvexError('The name you typed does not match')
    }

    // Delete the workspace row now (it vanishes from the switcher immediately) and
    // its logo object; the mountain of children — channels and everything under
    // them, groups, members, invitations — drains in bounded batches via
    // `cleanup.workspace`, which can't fit in one mutation at scale.
    if (workspace.imageKey) {
      try {
        await r2.deleteObject(ctx, workspace.imageKey)
      } catch {
        // orphaned object, not a failure the delete should roll back on
      }
    }
    await ctx.scheduler.runAfter(0, internal.cleanup.workspace, { workspaceId })

    await ctx.db.delete(workspaceId)
  }
})
