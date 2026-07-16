import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { summarizeReactionRows } from './lib/reactions'

/**
 * One-off backfills. Each is an `internalMutation` (never callable from a client),
 * batched, and **self-rescheduling** — the same shape as `cleanup.ts`, and for the
 * same reason: a migration that `.collect()`s a whole table fails on the table it most
 * needs to run against.
 *
 * Run one from the CLI:
 *
 *     npx convex run migrations:backfillReactions '{}'
 *
 * All of these are idempotent — re-running is safe, and each is a no-op once done.
 */

const BATCH = 100

/**
 * Populate `messages.reactions` (the denormalised summary) for messages written before
 * the field existed.
 *
 * Not required for correctness — `lib/messages.ts` `reactionsFor` falls back to reading
 * `messageReactions` when the field is absent, so old messages render correctly either
 * way. It's required for the *performance* the field exists for: until a message has a
 * summary, showing it still costs an index range, which is precisely the per-message
 * read this removed. Run it once; new messages are born with `reactions: []`.
 */
export const backfillReactions = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('messages')
      .paginate({ cursor: cursor ?? null, numItems: BATCH })

    let patched = 0
    for (const message of page.page) {
      if (message.reactions) continue // already done — idempotent
      const rows = await ctx.db
        .query('messageReactions')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
        .collect()
      await ctx.db.patch(message._id, { reactions: summarizeReactionRows(rows) })
      patched++
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.backfillReactions, {
        cursor: page.continueCursor
      })
    }
    return { patched, done: page.isDone }
  }
})
