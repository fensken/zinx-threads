import { ConvexError, v } from 'convex/values'
import { action, internalAction, internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { getChannelAccess, getCurrentUser, getMembership, requireUser } from './lib/auth'
import { rateLimiter } from './rateLimiter'
import { makeStrongPublicToken } from './lib/publicToken'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/**
 * Backend for **`form` channels** (Typeform-style). A form owns its own field set +
 * settings + a public submission token; each submit is a `formResponses` row. The owner
 * manages the form and views responses inside the channel (member-gated); the public
 * `publicGet` / `submit` pair backs the standalone `/f/<token>` submission page, reachable
 * by anyone with the link (or members only, per `requireSignIn`).
 */

const MAX_FIELDS = 40
const MAX_RESPONSES = 50_000
/** How many responses the owner's in-channel table loads. The true total comes from the
 *  `formStats` counter, so this is a page size, not a ceiling on what was collected. */
const RESPONSE_PAGE = 200
const MAX_VALUE_LEN = 5_000
const MAX_MULTI = 50
const cellValue = v.union(v.string(), v.number(), v.boolean(), v.array(v.string()), v.null())

const audienceValidator = v.union(
  v.literal('public'),
  v.literal('authenticated'),
  v.literal('workspace')
)
type Audience = 'public' | 'authenticated' | 'workspace'

/** Resolve a form's effective audience (new `audience` field, else the legacy flag). */
function resolveAudience(form: Doc<'forms'>): Audience {
  return form.audience ?? (form.requireSignIn ? 'authenticated' : 'public')
}

const formFieldType = v.union(
  v.literal('text'),
  v.literal('longText'),
  v.literal('number'),
  v.literal('select'),
  v.literal('multiSelect'),
  v.literal('checkbox'),
  v.literal('switch'),
  v.literal('radio'),
  v.literal('range'),
  v.literal('date'),
  v.literal('time'),
  v.literal('email'),
  v.literal('phone'),
  v.literal('url')
)

const formFieldInput = v.object({
  id: v.string(),
  name: v.string(),
  type: formFieldType,
  required: v.optional(v.boolean()),
  options: v.optional(v.array(v.object({ id: v.string(), label: v.string() })))
})

/** Resolve a form channel the caller may manage (member of it), returning the form row. */
async function requireFormChannel(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<'channels'>,
  userId: Id<'users'>
): Promise<Doc<'forms'>> {
  const access = await getChannelAccess(ctx, channelId, userId)
  if (!access) throw new ConvexError('Channel not found')
  if (access.channel.kind !== 'form') throw new ConvexError('Not a form channel')
  const form = await ctx.db
    .query('forms')
    .withIndex('by_channel', (q) => q.eq('channelId', channelId))
    .unique()
  if (!form) throw new ConvexError('Form not found')
  return form
}

// ── Owner / member side ───────────────────────────────────────────────────────

/** The form + its responses (owner view), member-gated. Null-safe. */
export const getByChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access || access.channel.kind !== 'form') return null
    const form = await ctx.db
      .query('forms')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .unique()
    if (!form) return null
    const responses = await ctx.db
      .query('formResponses')
      .withIndex('by_form', (q) => q.eq('formId', form._id))
      .order('desc')
      .take(RESPONSE_PAGE)
    const stats = await ctx.db
      .query('formStats')
      .withIndex('by_form', (q) => q.eq('formId', form._id))
      .unique()
    // The counter is the true total; `responses` is only the newest page. Forms that predate
    // the counter have no row yet, so fall back to what we loaded.
    return { form, responses, responseCount: stats?.responseCount ?? responses.length }
  }
})

/** Edit the form's schema + settings (member-gated). */
export const saveForm = mutation({
  args: {
    channelId: v.id('channels'),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    fields: v.optional(v.array(formFieldInput)),
    audience: v.optional(audienceValidator),
    closesAt: v.optional(v.union(v.number(), v.null())),
    confirmationMessage: v.optional(v.union(v.string(), v.null()))
  },
  handler: async (ctx, { channelId, title, description, fields, audience, closesAt, confirmationMessage }) => {
    const user = await requireUser(ctx)
    const form = await requireFormChannel(ctx, channelId, user._id)
    if (fields && fields.length > MAX_FIELDS) {
      throw new ConvexError(`A form can have at most ${MAX_FIELDS} fields`)
    }
    const patch: Partial<Doc<'forms'>> = { updatedAt: Date.now() }
    if (title !== undefined) patch.title = title.trim().slice(0, 200) || 'Untitled form'
    if (description !== undefined) patch.description = description?.slice(0, 2000) ?? undefined
    if (fields !== undefined) patch.fields = fields
    if (audience !== undefined) {
      patch.audience = audience
      // Keep the legacy flag consistent for any old reader.
      patch.requireSignIn = audience !== 'public'
    }
    if (closesAt !== undefined) patch.closesAt = closesAt ?? undefined
    if (confirmationMessage !== undefined) {
      patch.confirmationMessage = confirmationMessage?.slice(0, 500) ?? undefined
    }
    await ctx.db.patch(form._id, patch)
  }
})

/**
 * Rotate the public link (invalidates the old `/f/<token>`).
 *
 * An **action**, not a mutation, because a link that gates a form's questions has to come from
 * `crypto.getRandomValues` — see lib/publicToken.ts. The access check lives in the internal
 * mutation below, where the database is.
 */
export const regenerateLink = action({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }): Promise<{ publicToken: string }> => {
    const publicToken = makeStrongPublicToken()
    await ctx.runMutation(internal.forms.setPublicToken, { channelId, publicToken })
    return { publicToken }
  }
})

/** Store a rotated token. Internal — the caller minted it in an action; this re-checks access. */
export const setPublicToken = internalMutation({
  args: { channelId: v.id('channels'), publicToken: v.string() },
  handler: async (ctx, { channelId, publicToken }) => {
    const user = await requireUser(ctx)
    const form = await requireFormChannel(ctx, channelId, user._id)
    await ctx.db.patch(form._id, { publicToken, updatedAt: Date.now() })
  }
})

/**
 * Replace a freshly-seeded form's placeholder token with a real one. Scheduled by `seedForm`
 * (see lib/publicToken.ts): channel creation is a mutation and so cannot generate a secure
 * token itself. Runs immediately after the creating mutation commits — before any UI has had a
 * chance to show a link — so no shareable link is ever the weak placeholder.
 *
 * No auth check: it's internal, it takes a form id the scheduler supplied, and it only replaces
 * a secret with a stronger one.
 */
export const strengthenToken = internalAction({
  args: { formId: v.id('forms') },
  handler: async (ctx, { formId }) => {
    await ctx.runMutation(internal.forms.applyStrongToken, {
      formId,
      publicToken: makeStrongPublicToken()
    })
  }
})

export const applyStrongToken = internalMutation({
  args: { formId: v.id('forms'), publicToken: v.string() },
  handler: async (ctx, { formId, publicToken }) => {
    const form = await ctx.db.get(formId)
    // Only ever upgrade the placeholder. If the owner already rotated the link by hand, that
    // token is the real one and must win — this action must not clobber it.
    if (!form || !form.publicToken.startsWith('seed')) return
    await ctx.db.patch(formId, { publicToken })
  }
})

export const deleteResponse = mutation({
  args: { responseId: v.id('formResponses') },
  handler: async (ctx, { responseId }) => {
    const user = await requireUser(ctx)
    const response = await ctx.db.get(responseId)
    if (!response) return
    await requireFormChannel(ctx, response.channelId, user._id)
    await ctx.db.delete(responseId)
    // Keep the counter honest, or deleting responses would eventually wedge the form against
    // its cap with nothing in it. Floored at 0 for forms that predate the counter.
    const stats = await ctx.db
      .query('formStats')
      .withIndex('by_form', (q) => q.eq('formId', response.formId))
      .unique()
    if (stats) await ctx.db.patch(stats._id, { responseCount: Math.max(0, stats.responseCount - 1) })
  }
})

// ── Public side (the /f/<token> submission page) ───────────────────────────────

/** The form's SCHEMA for the public page — never its responses. No auth: anyone with the
 *  link may load it (the submit still enforces `requireSignIn`). Returns `null` for a bad
 *  token so the page shows "form not found" rather than an error. */
export const publicGet = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const form = await ctx.db
      .query('forms')
      .withIndex('by_public_token', (q) => q.eq('publicToken', token))
      .unique()
    if (!form) return null
    const audience = resolveAudience(form)
    const user = await getCurrentUser(ctx)

    // Decide whether THIS caller may submit, so the page can show the right gate.
    let access: 'ok' | 'need-auth' | 'need-member' = 'ok'
    if (audience === 'authenticated' && !user) access = 'need-auth'
    else if (audience === 'workspace') {
      if (!user) access = 'need-auth'
      else if (!(await getMembership(ctx, form.workspaceId, user._id))) access = 'need-member'
    }

    const workspace = access === 'need-member' ? await ctx.db.get(form.workspaceId) : null
    return {
      title: form.title,
      description: form.description,
      // Don't leak the questions to someone who isn't allowed to answer.
      fields: access === 'ok' ? form.fields : [],
      audience,
      access,
      workspaceName: workspace?.name,
      confirmationMessage: form.confirmationMessage,
      closed: form.closesAt !== undefined && form.closesAt < Date.now()
    }
  }
})

/** Accept a public submission. Rate-limited per form token; validates required fields and
 *  caps sizes. Enforces `requireSignIn` and `closesAt`. */
export const submit = mutation({
  args: {
    token: v.string(),
    values: v.record(v.string(), cellValue)
  },
  handler: async (ctx, { token, values }) => {
    const form = await ctx.db
      .query('forms')
      .withIndex('by_public_token', (q) => q.eq('publicToken', token))
      .unique()
    if (!form) throw new ConvexError('This form is no longer available')
    if (form.closesAt !== undefined && form.closesAt < Date.now()) {
      throw new ConvexError('This form is closed')
    }

    // Keyed by the form token — a per-form spam guard on a public endpoint.
    const status = await rateLimiter.limit(ctx, 'formSubmit', { key: token })
    if (!status.ok) throw new ConvexError('Too many submissions — please try again shortly')

    const audience = resolveAudience(form)
    const user = await getCurrentUser(ctx)
    let submittedBy: Id<'users'> | undefined
    if (audience === 'authenticated') {
      if (!user) throw new ConvexError('You must be signed in to submit this form')
      submittedBy = user._id
    } else if (audience === 'workspace') {
      if (!user) throw new ConvexError('You must be signed in to submit this form')
      if (!(await getMembership(ctx, form.workspaceId, user._id))) {
        throw new ConvexError('Only members of this workspace can submit this form')
      }
      submittedBy = user._id
    } else {
      // Public — record the submitter if they happen to be signed in, else anonymous.
      submittedBy = user?._id
    }

    return await recordSubmission(ctx, form, values, submittedBy)
  }
})

/** Validate required fields, sanitize + cap values against the form's own schema, enforce the
 *  per-form response cap, and insert the response. Shared by the public `submit` and the
 *  in-app `submitByChannel`. Ignores keys not in the schema (a crafted client can't smuggle
 *  extra data). */
async function recordSubmission(
  ctx: MutationCtx,
  form: Doc<'forms'>,
  values: Record<string, string | number | boolean | string[] | null>,
  submittedBy: Id<'users'> | undefined
): Promise<{ confirmationMessage: string }> {
  const clean: Record<string, string | number | boolean | string[] | null> = {}
  for (const field of form.fields) {
    const raw = values[field.id]
    const empty =
      raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)
    // A required boolean (checkbox/switch) means "must be ON" — `false` does not satisfy it.
    const requiredUnmet =
      field.type === 'checkbox' || field.type === 'switch' ? raw !== true : empty
    if (field.required && requiredUnmet) throw new ConvexError(`"${field.name}" is required`)
    if (empty) continue
    if (Array.isArray(raw)) {
      clean[field.id] = raw.slice(0, MAX_MULTI).map((s) => String(s).slice(0, MAX_VALUE_LEN))
    } else if (typeof raw === 'string') clean[field.id] = raw.slice(0, MAX_VALUE_LEN)
    else clean[field.id] = raw
  }

  // O(1) cap check — see the `formStats` comment in schema.ts for why the count is neither
  // recomputed from the rows nor stored on the form document.
  const stats = await ctx.db
    .query('formStats')
    .withIndex('by_form', (q) => q.eq('formId', form._id))
    .unique()
  const count = stats?.responseCount ?? 0
  if (count >= MAX_RESPONSES) throw new ConvexError('This form is no longer accepting responses')

  await ctx.db.insert('formResponses', {
    formId: form._id,
    channelId: form.channelId,
    submittedBy,
    values: clean,
    submittedAt: Date.now()
  })
  if (stats) await ctx.db.patch(stats._id, { responseCount: count + 1 })
  else await ctx.db.insert('formStats', { formId: form._id, responseCount: 1 })
  return { confirmationMessage: form.confirmationMessage ?? 'Thanks — your response was recorded.' }
}

/** In-app submission by a channel member — the form channel shows the form inline and
 *  anyone who can see the channel can fill it (independent of the public-link `audience`,
 *  which governs the shared link, not in-app filling). */
export const submitByChannel = mutation({
  args: { channelId: v.id('channels'), values: v.record(v.string(), cellValue) },
  handler: async (ctx, { channelId, values }) => {
    const user = await requireUser(ctx)
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access || access.channel.kind !== 'form') throw new ConvexError('Not a form channel')
    const form = await ctx.db
      .query('forms')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .unique()
    if (!form) throw new ConvexError('Form not found')
    if (form.closesAt !== undefined && form.closesAt < Date.now()) {
      throw new ConvexError('This form is closed')
    }
    return await recordSubmission(ctx, form, values, user._id)
  }
})
