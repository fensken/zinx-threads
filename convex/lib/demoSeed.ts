// Default groups + channels seeded into every newly-created workspace so it has a
// rich, Discord/_zinx-style structure out of the box (a new workspace still has
// only its owner — no fake teammates or messages).
//
// `page` and `kanban` channels now persist to Convex (`convex/pages.ts`,
// `convex/boards.ts`), so no channel name has to match a mock key any more — pages
// start empty, and boards are seeded with `DEFAULT_BOARD_COLUMNS`.

export type DemoKind = 'chat' | 'voice' | 'page' | 'kanban'

/** Workspace slugs that can't be taken. Empty now that the mock demo is gone — kept
 *  as a hook for any future reservations (e.g. route-conflicting words). */
export const RESERVED_WORKSPACE_SLUGS: string[] = []

/** Default sidebar groups (categories), in order. */
export const DEFAULT_GROUPS = ['Text Channels', 'Docs', 'Project', 'Voice'] as const
export type DefaultGroup = (typeof DEFAULT_GROUPS)[number]

/** The workspace's home channel: ungrouped, at the very top, `isDefault`.
 *  Renameable, but never moved or deleted — so `/w/<slug>` always has a landing
 *  target and a workspace can't be left with zero channels.
 *
 *  `order: -1` (not 0) so it stays first even after a drag-and-drop reorder
 *  rewrites the other ungrouped channels' orders starting at 0. */
export const DEFAULT_CHANNEL = {
  name: 'general',
  kind: 'chat' as const,
  emoji: '💬',
  topic: 'Workspace-wide chatter',
  order: -1
}

export const DEMO_CHANNELS: Array<{
  name: string
  kind: DemoKind
  emoji?: string
  topic?: string
  group: DefaultGroup
}> = [
  // No `general` here — that's `DEFAULT_CHANNEL`, seeded ungrouped above the groups.
  { name: 'welcome', kind: 'chat', emoji: '👋', group: 'Text Channels' },
  { name: 'zinx', kind: 'chat', topic: 'Everything about the app', group: 'Text Channels' },
  { name: 'business-talks', kind: 'chat', group: 'Text Channels' },
  { name: 'roadmap', kind: 'page', emoji: '🗺️', group: 'Docs' },
  { name: 'handbook', kind: 'page', emoji: '📘', group: 'Docs' },
  { name: 'meeting-notes', kind: 'page', emoji: '📝', group: 'Docs' },
  { name: 'sprint-board', kind: 'kanban', emoji: '📋', group: 'Project' },
  { name: 'General', kind: 'voice', group: 'Voice' }
]
