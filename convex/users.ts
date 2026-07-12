import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { getCurrentUser, requireUser } from './lib/auth'
import { markUploadUsed, objectUrl, r2 } from './files'

// Avatar fallback colors (categorical — allowed hardcoded exception). Picked
// deterministically from the user id so a person keeps the same color.
const AVATAR_COLORS = [
  '#5865f2',
  '#3ba55d',
  '#eb459e',
  '#faa61a',
  '#00a8fc',
  '#e67e22',
  '#8b5cf6',
  '#e74c3c'
]
function colorFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

/** A readable fallback name from an email when the IdP gives no first/last name:
 *  the local part, split on separators and title-cased (jane.doe → "Jane Doe"). */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  return words.join(' ') || email
}

/** The current user's row, or null if not signed in / not yet stored. */
export const me = query({
  args: {},
  handler: async (ctx) => getCurrentUser(ctx)
})

/** Update the current user's global account profile (display name + avatar color).
 *  This is the account-wide identity; per-workspace nicknames live on
 *  `workspaceMembers.displayName` (see `members.updateMyProfile`). */
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    color: v.optional(v.string())
  },
  handler: async (ctx, { name, color }) => {
    const user = await requireUser(ctx)
    const patch: { name?: string; color?: string } = {}
    if (name !== undefined) {
      const trimmed = name.trim().slice(0, 60)
      if (trimmed.length) patch.name = trimmed
    }
    if (color !== undefined) patch.color = color
    await ctx.db.patch(user._id, patch)
  }
})

/** Adopt a freshly-uploaded R2 object as the account avatar.
 *
 *  The browser uploads via `useUploadFile` (which calls `files.generateUploadUrl`
 *  + `files.syncMetadata`), then hands us the object `key`. We resolve it to a
 *  durable URL and store both — the URL is what every avatar consumer reads, the
 *  key lets a later re-upload delete the previous object. Keys are random and
 *  each caller only ever passes its own, so we trust it (avatars are public).
 *  Delete of the old object is best-effort: a stale object is wasted storage, not
 *  a correctness bug, so a failed cleanup must not fail the swap. */
export const setUploadedAvatar = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const user = await requireUser(ctx)
    const previousKey = user.avatarKey
    await markUploadUsed(ctx, key)
    await ctx.db.patch(user._id, { avatarKey: key, avatarUrl: await objectUrl(key) })
    if (previousKey && previousKey !== key) {
      try {
        await r2.deleteObject(ctx, previousKey)
      } catch {
        // ignore — orphaned object, not a failure the user should see
      }
    }
  }
})

/** Remove a user-uploaded avatar, reverting to the colored-initials fallback.
 *  (Leaves an external Google/WorkOS photo untouched — that's not ours to clear;
 *  it only clears an upload, identified by `avatarKey`.) */
export const removeUploadedAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    if (!user.avatarKey) return
    const key = user.avatarKey
    await ctx.db.patch(user._id, { avatarKey: undefined, avatarUrl: undefined })
    try {
      await r2.deleteObject(ctx, key)
    } catch {
      // ignore — see setUploadedAvatar
    }
  }
})

const userPresence = v.union(
  v.literal('online'),
  v.literal('away'),
  v.literal('dnd'),
  v.literal('invisible')
)

/** Set the current user's presence (online / away / dnd / invisible). */
export const setPresence = mutation({
  args: { presence: userPresence },
  handler: async (ctx, { presence }) => {
    const user = await requireUser(ctx)
    await ctx.db.patch(user._id, { presence })
  }
})

/** Set (or clear) the current user's custom status — a short text + optional
 *  emoji. Empty text clears both (patching `undefined` removes the field). */
export const setCustomStatus = mutation({
  args: { emoji: v.optional(v.string()), text: v.string() },
  handler: async (ctx, { emoji, text }) => {
    const user = await requireUser(ctx)
    const trimmed = text.trim().slice(0, 100)
    await ctx.db.patch(user._id, {
      statusEmoji: emoji?.trim() ? emoji.trim() : undefined,
      statusText: trimmed.length ? trimmed : undefined
    })
  }
})

/**
 * Upsert the signed-in WorkOS user into our `users` table. Called by the client
 * right after sign-in, which is the only place that has the full WorkOS profile.
 * Idempotent.
 *
 * The **identity** comes from the JWT (`tokenIdentifier` / `subject`), never from
 * an argument. `name` and `avatarUrl` are cosmetic and may come from the client.
 *
 * `email` here is still UNVERIFIED (WorkOS's access token carries no `email`
 * claim, so `identity.email` is usually undefined and the client's value is all
 * we have) — so it must NEVER be an authorization key. Invitations no longer key
 * on it: they are capability tokens (`invitations.acceptByToken`), which closed
 * the old unverified-email hole. Two hardenings remain so the stored value is at
 * least self-consistent for display/notes:
 *   1. an existing row's email can only be changed by a *verified* (JWT) email —
 *      an authenticated caller can't repoint their own row at someone else's;
 *   2. `emailVerified` records where the value came from.
 * Do not reintroduce any flow that treats this email as proof of ownership.
 */
export const store = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new ConvexError('Not authenticated')

    // `identity.email` is only present if the IdP puts it in the JWT.
    const verifiedEmail = identity.email?.trim().toLowerCase()
    const existing = await getCurrentUser(ctx)

    // Always land a non-empty name: prefer the IdP name, keep an existing one,
    // else derive from the email so the UI never has to fall back to the address.
    if (existing) {
      await ctx.db.patch(existing._id, {
        // Backfill for rows written before `tokenIdentifier` existed.
        tokenIdentifier: identity.tokenIdentifier,
        // Deliberately NOT `args.email` — see the note above.
        ...(verifiedEmail ? { email: verifiedEmail, emailVerified: true } : {}),
        name: args.name ?? existing.name ?? nameFromEmail(existing.email),
        // A user-uploaded avatar (`avatarKey` set) wins over the IdP photo — sign-in
        // must not clobber it. Only fall back to the WorkOS photo when there's no
        // upload.
        avatarUrl: existing.avatarKey ? existing.avatarUrl : (args.avatarUrl ?? existing.avatarUrl)
      })
      return existing._id
    }

    const email = verifiedEmail ?? args.email.trim().toLowerCase()
    return await ctx.db.insert('users', {
      externalId: identity.subject,
      tokenIdentifier: identity.tokenIdentifier,
      provider: 'workos',
      email,
      emailVerified: Boolean(verifiedEmail),
      name: args.name ?? nameFromEmail(email),
      avatarUrl: args.avatarUrl,
      color: colorFor(identity.subject)
    })
  }
})
