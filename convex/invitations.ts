import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { getCurrentUser, getMembership, requireUser } from './lib/auth'
import { rateLimiter } from './rateLimiter'

const roleArg = v.union(v.literal('admin'), v.literal('member'))
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Workspace invite LINKS (Discord-style): a reusable link the inviter copies and
// shares however they like. Anyone who opens it joins — optionally restricted to a
// whitelist of emails, and optionally expiring. No email is sent (that's the
// deliberate difference from a one-time emailed code). The token in the link is the
// capability; `allowedEmails` / `expiresAt` narrow it.

/** Alphanumeric, unambiguous, ~120 bits of entropy (avoids 0/O/1/l/I). */
function makeToken(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 24; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_ALLOWED_EMAILS = 100

function cleanEmails(emails: string[] | undefined): string[] | undefined {
  if (!emails || emails.length === 0) return undefined
  const cleaned = [
    ...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))
  ]
  if (cleaned.length === 0) return undefined
  if (cleaned.length > MAX_ALLOWED_EMAILS) {
    throw new ConvexError(`At most ${MAX_ALLOWED_EMAILS} emails can be whitelisted`)
  }
  return cleaned
}

/** Create a reusable invite link (owner/admin). `expiresInDays` omitted = permanent;
 *  `allowedEmails` omitted/empty = anyone with the link may join. Returns the code —
 *  the client builds the shareable URL (`/invite/<code>`). */
export const invite = mutation({
  args: {
    workspaceId: v.id('workspaces'),
    role: v.optional(roleArg),
    /** Omit for a permanent link. */
    expiresInDays: v.optional(v.number()),
    /** Omit/empty to allow anyone with the link. */
    allowedEmails: v.optional(v.array(v.string()))
  },
  handler: async (ctx, { workspaceId, role, expiresInDays, allowedEmails }) => {
    const user = await requireUser(ctx)
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can invite people')
    }
    await rateLimiter.limit(ctx, 'createInvite', { key: user._id, throws: true })

    const expiresAt =
      expiresInDays && expiresInDays > 0 ? Date.now() + expiresInDays * DAY_MS : undefined
    const token = makeToken()
    await ctx.db.insert('workspaceInvitations', {
      workspaceId,
      invitedBy: user._id,
      role: role ?? 'member',
      status: 'pending',
      token,
      expiresAt,
      allowedEmails: cleanEmails(allowedEmails),
      createdAt: Date.now()
    })
    return { code: token }
  }
})

/** Preview an invite link (the join screen). Auth optional; reports whether it's
 *  valid, expired, whether the caller is already a member, and — when the link is
 *  email-restricted — whether the caller's email is allowed (drives the CTA). */
export const preview = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await getCurrentUser(ctx)
    const invitation = await ctx.db
      .query('workspaceInvitations')
      .withIndex('by_token', (q) => q.eq('token', code.trim()))
      .unique()
    if (!invitation || invitation.status === 'revoked') return { valid: false as const }

    const expired = invitation.expiresAt !== undefined && invitation.expiresAt < Date.now()
    const workspace = await ctx.db.get(invitation.workspaceId)
    if (!workspace) return { valid: false as const }
    const inviter = await ctx.db.get(invitation.invitedBy)
    const alreadyMember = user
      ? Boolean(await getMembership(ctx, invitation.workspaceId, user._id))
      : false
    // Email restriction: allowed unless a whitelist exists and the caller's email
    // isn't on it. When signed out we can't check, so don't block the preview.
    const emailAllowed =
      !invitation.allowedEmails ||
      !user ||
      invitation.allowedEmails.includes((user.email ?? '').toLowerCase())

    return {
      valid: true as const,
      expired,
      emailAllowed,
      emailRestricted: Boolean(invitation.allowedEmails),
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      workspaceIcon: workspace.icon,
      workspaceImageUrl: workspace.imageUrl,
      inviterName: inviter?.name ?? 'Someone',
      alreadyMember
    }
  }
})

/** Redeem an invite link → join the workspace. **Reusable** — the link is not
 *  consumed. Enforces expiry + the email whitelist; idempotent if already a member. */
export const acceptByToken = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx)
    const invitation = await ctx.db
      .query('workspaceInvitations')
      .withIndex('by_token', (q) => q.eq('token', code.trim()))
      .unique()
    if (!invitation || invitation.status === 'revoked') {
      throw new ConvexError('This invite link is no longer valid')
    }
    if (invitation.expiresAt !== undefined && invitation.expiresAt < Date.now()) {
      throw new ConvexError('This invite link has expired')
    }
    if (
      invitation.allowedEmails &&
      !invitation.allowedEmails.includes((user.email ?? '').toLowerCase())
    ) {
      throw new ConvexError('This invite link is restricted to specific email addresses')
    }
    const workspace = await ctx.db.get(invitation.workspaceId)
    if (!workspace) throw new ConvexError('That workspace no longer exists')

    if (!(await getMembership(ctx, invitation.workspaceId, user._id))) {
      await ctx.db.insert('workspaceMembers', {
        workspaceId: invitation.workspaceId,
        userId: user._id,
        role: invitation.role,
        joinedAt: Date.now()
      })
    }
    // Do NOT flip status — a reusable link stays active until revoked/expired.
    return { slug: workspace.slug }
  }
})

/** Active invite links a workspace owner/admin has created — for the members/invite
 *  view (copy the link, see expiry + whitelist, revoke). Owner/admin only. */
export const listByWorkspace = query({
  args: { workspaceId: v.id('workspaces') },
  handler: async (ctx, { workspaceId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return []
    const membership = await getMembership(ctx, workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) return []

    const invites = await ctx.db
      .query('workspaceInvitations')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', workspaceId))
      .collect()
    const now = Date.now()
    return invites
      .filter((i) => i.status === 'pending' && i.token)
      .map((i) => ({
        _id: i._id,
        code: i.token as string,
        role: i.role,
        expiresAt: i.expiresAt,
        expired: i.expiresAt !== undefined && i.expiresAt < now,
        allowedEmails: i.allowedEmails ?? [],
        createdAt: i.createdAt
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }
})

/** Revoke an invite link (owner/admin) — it stops working immediately. */
export const revoke = mutation({
  args: { invitationId: v.id('workspaceInvitations') },
  handler: async (ctx, { invitationId }) => {
    const user = await requireUser(ctx)
    const invitation = await ctx.db.get(invitationId)
    if (!invitation) return
    const membership = await getMembership(ctx, invitation.workspaceId, user._id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ConvexError('Only owners and admins can revoke invites')
    }
    await ctx.db.patch(invitationId, { status: 'revoked' })
  }
})
