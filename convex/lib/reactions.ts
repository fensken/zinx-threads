import type { Doc, Id } from '../_generated/dataModel'

/**
 * The denormalised reaction summary carried on the message document.
 *
 * `messageReactions` is still the source of truth — it's the unique index that makes
 * "one reaction per user per emoji" enforceable. This summary is a cache, maintained
 * by `messages.toggleReaction`, that exists so **reading** a page of messages doesn't
 * have to touch the table at all. See the `messages.reactions` note in `schema.ts`.
 */
export interface ReactionSummary {
  emoji: string
  /** Exact, even past the `userIds` sample. */
  count: number
  /** Who reacted, up to `REACTOR_SAMPLE`. Drives the viewer's `reacted` flag. */
  userIds: Id<'users'>[]
}

/** How many reactors we remember per emoji. The summary lives on the message
 *  document, so this array must not grow without bound (a 500-person workspace all
 *  hitting 👍 on one message is a real thing). `count` stays exact past the sample;
 *  a viewer who isn't in a truncated sample costs one indexed lookup to resolve. */
export const REACTOR_SAMPLE = 100

export function summarizeReactionRows(rows: Doc<'messageReactions'>[]): ReactionSummary[] {
  const grouped = new Map<string, ReactionSummary>()
  for (const row of rows) {
    const entry = grouped.get(row.emoji) ?? { emoji: row.emoji, count: 0, userIds: [] }
    entry.count += 1
    if (entry.userIds.length < REACTOR_SAMPLE) entry.userIds.push(row.userId)
    grouped.set(row.emoji, entry)
  }
  return [...grouped.values()]
}

/** Fold one toggle into the summary. Pure — the caller patches the result. */
export function applyReaction(
  summary: ReactionSummary[],
  emoji: string,
  userId: Id<'users'>,
  op: 'add' | 'remove'
): ReactionSummary[] {
  const next = summary.map((entry) => ({ ...entry, userIds: [...entry.userIds] }))
  const entry = next.find((candidate) => candidate.emoji === emoji)

  if (op === 'add') {
    if (!entry) {
      next.push({ emoji, count: 1, userIds: [userId] })
      return next
    }
    if (entry.userIds.includes(userId)) return next // already counted — nothing to do
    entry.count += 1
    if (entry.userIds.length < REACTOR_SAMPLE) entry.userIds.push(userId)
    return next
  }

  if (!entry) return next
  entry.count = Math.max(0, entry.count - 1)
  entry.userIds = entry.userIds.filter((candidate) => candidate !== userId)
  // The last reaction of a kind removes the pill entirely.
  return next.filter((candidate) => candidate.count > 0)
}
