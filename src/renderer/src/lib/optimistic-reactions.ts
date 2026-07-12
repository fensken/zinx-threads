export interface ReactionPill {
  emoji: string
  count: number
  reacted: boolean
}

/** Apply `messages.toggleReaction` to a local reaction list, the way the server
 *  will. Used by Convex's `withOptimisticUpdate` so a reaction pill flips on the
 *  click rather than after a round-trip — Convex rolls this back automatically
 *  once the real query result lands. */
export function toggleLocalReaction(reactions: ReactionPill[], emoji: string): ReactionPill[] {
  const existing = reactions.find((pill) => pill.emoji === emoji)
  if (!existing) return [...reactions, { emoji, count: 1, reacted: true }]

  if (existing.reacted) {
    // Removing mine: the pill goes when I was the only one holding it up.
    if (existing.count <= 1) return reactions.filter((pill) => pill.emoji !== emoji)
    return reactions.map((pill) =>
      pill.emoji === emoji ? { ...pill, count: pill.count - 1, reacted: false } : pill
    )
  }
  return reactions.map((pill) =>
    pill.emoji === emoji ? { ...pill, count: pill.count + 1, reacted: true } : pill
  )
}
