// Default groups + channels seeded into every newly-created workspace so it has a
// rich, Discord/_zinx-style structure out of the box (a new workspace still has
// only its owner — no fake teammates or messages).
//
// `page` and `kanban` channels now persist to Convex (`convex/pages.ts`,
// `convex/boards.ts`), so no channel name has to match a mock key any more — pages
// start empty, and boards are seeded with `DEFAULT_BOARD_COLUMNS`.

export type DemoKind =
  | 'chat'
  | 'voice'
  | 'page'
  | 'kanban'
  | 'whiteboard'
  | 'database'
  | 'form'

/** Workspace slugs that can't be taken. Empty now that the mock demo is gone — kept
 *  as a hook for any future reservations (e.g. route-conflicting words). */
export const RESERVED_WORKSPACE_SLUGS: string[] = []

/** Default sidebar groups (categories), in order. */
export const DEFAULT_GROUPS = ['Text Channels', 'Docs', 'Project', 'Voice'] as const
// NB: every channel `group` below must be one of these.
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
  topic: 'Workspace-wide chatter',
  order: -1
}

// No decorative `emoji` on seeded channels: the kind icon (#/page/kanban/voice) is the
// channel's identity, and the "Add a channel" flow doesn't set one — so seeding emojis
// only made the sample channels look inconsistent with the ones you create. (The
// `channels.emoji` field still exists; nothing sets it via the UI today.)
export const DEMO_CHANNELS: Array<{
  name: string
  kind: DemoKind
  topic?: string
  group: DefaultGroup
}> = [
  // No `general` here — that's `DEFAULT_CHANNEL`, seeded ungrouped above the groups.
  // A workspace opens showcasing ONE of every channel kind, so people discover what the
  // app can do without having to create each type themselves.
  { name: 'welcome', kind: 'chat', group: 'Text Channels' },
  { name: 'zinx', kind: 'chat', topic: 'Everything about the app', group: 'Text Channels' },
  { name: 'business-talks', kind: 'chat', group: 'Text Channels' },
  { name: 'roadmap', kind: 'page', group: 'Docs' },
  { name: 'handbook', kind: 'page', group: 'Docs' },
  { name: 'meeting-notes', kind: 'page', group: 'Docs' },
  { name: 'sprint-board', kind: 'kanban', topic: 'Track work across the sprint', group: 'Project' },
  { name: 'project-tracker', kind: 'database', topic: 'A table of everything in flight', group: 'Project' },
  { name: 'brainstorm', kind: 'whiteboard', topic: 'Sketch ideas together', group: 'Project' },
  { name: 'feedback', kind: 'form', topic: 'Collect responses from anyone', group: 'Docs' },
  { name: 'General', kind: 'voice', group: 'Voice' }
]
