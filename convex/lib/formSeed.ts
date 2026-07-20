import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { makePublicToken } from './publicToken'

/**
 * Seed a fresh `form` channel with a starter form (title + one required text field) and a
 * public submission token, so the channel opens as an editable form rather than nothing.
 * Called by `channels.create` when `kind === 'form'`.
 */
export async function seedForm(
  ctx: MutationCtx,
  { workspaceId, channelId, title }: { workspaceId: Id<'workspaces'>; channelId: Id<'channels'>; title: string }
): Promise<void> {
  await ctx.db.insert('forms', {
    workspaceId,
    channelId,
    title: title.trim() || 'Untitled form',
    fields: [{ id: 'name', name: 'Name', type: 'text', required: true }],
    requireSignIn: false,
    audience: 'public',
    publicToken: makePublicToken(),
    updatedAt: Date.now()
  })
}

/** A richer starter form + one sample response — used only by `workspaces.create`, so the
 *  seeded form showcases several field types and the Responses tab isn't empty. */
export async function seedFormWithSamples(
  ctx: MutationCtx,
  { workspaceId, channelId, title, userId }: {
    workspaceId: Id<'workspaces'>
    channelId: Id<'channels'>
    title: string
    userId: Id<'users'>
  }
): Promise<void> {
  const formId = await ctx.db.insert('forms', {
    workspaceId,
    channelId,
    title: title.trim() || 'Feedback',
    description: 'Tell us what you think — this is a sample form.',
    fields: [
      { id: 'name', name: 'Your name', type: 'text', required: true },
      { id: 'email', name: 'Email', type: 'email' },
      {
        id: 'rating',
        name: 'How was it?',
        type: 'select',
        required: true,
        options: [
          { id: 'great', label: 'Great' },
          { id: 'ok', label: 'Okay' },
          { id: 'bad', label: 'Not good' }
        ]
      },
      { id: 'comments', name: 'Anything else?', type: 'longText' }
    ],
    requireSignIn: false,
    audience: 'public',
    publicToken: makePublicToken(),
    updatedAt: Date.now()
  })
  await ctx.db.insert('formResponses', {
    formId,
    channelId,
    submittedBy: userId,
    values: { name: 'Sample response', rating: 'great', comments: 'Loving it so far!' },
    submittedAt: Date.now()
  })
}
