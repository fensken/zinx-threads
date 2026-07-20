import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/**
 * Sample content for the SEEDED page channels of a brand-new workspace, so a page shows
 * how the editor works instead of being blank. Only `workspaces.create` uses this — a page
 * channel you create yourself opens empty. The content is a BlockNote `Block[]` as JSON
 * (the same shape `pages.content` stores); BlockNote normalises it on load.
 */

type SeedBlock = { type: 'heading' | 'paragraph'; text: string; level?: number }

function toDoc(blocks: SeedBlock[]): string {
  const doc = blocks.map((block, index) => ({
    id: `seed-${index}`,
    type: block.type,
    props:
      block.type === 'heading'
        ? { level: block.level ?? 1, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' }
        : { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
    content: block.text ? [{ type: 'text', text: block.text, styles: {} }] : [],
    children: []
  }))
  return JSON.stringify(doc)
}

const PAGE_SEEDS: Record<string, { title: string; blocks: SeedBlock[] }> = {
  roadmap: {
    title: 'Roadmap',
    blocks: [
      { type: 'heading', text: 'Roadmap', level: 1 },
      { type: 'paragraph', text: 'What we’re building, in order. This is a sample page.' },
      { type: 'heading', text: 'Now', level: 2 },
      { type: 'paragraph', text: 'The current focus for the team.' },
      { type: 'heading', text: 'Next', level: 2 },
      { type: 'paragraph', text: 'Coming up soon.' },
      { type: 'heading', text: 'Later', level: 2 },
      { type: 'paragraph', text: 'Ideas we might get to.' }
    ]
  },
  handbook: {
    title: 'Handbook',
    blocks: [
      { type: 'heading', text: 'Team Handbook', level: 1 },
      { type: 'paragraph', text: 'How we work together. Edit this page to make it your own.' },
      { type: 'heading', text: 'Communication', level: 2 },
      { type: 'paragraph', text: 'Where we talk, and when.' },
      { type: 'heading', text: 'Tools', level: 2 },
      { type: 'paragraph', text: 'The apps we use day to day.' }
    ]
  },
  'meeting-notes': {
    title: 'Meeting Notes',
    blocks: [
      { type: 'heading', text: 'Meeting Notes', level: 1 },
      { type: 'paragraph', text: 'A place to capture what was discussed and decided.' },
      { type: 'heading', text: 'Agenda', level: 2 },
      { type: 'paragraph', text: 'What we’ll cover.' },
      { type: 'heading', text: 'Action items', level: 2 },
      { type: 'paragraph', text: 'Who does what next.' }
    ]
  }
}

/** Seed a page channel's content if we have a sample for its name; otherwise no-op. */
export async function seedPage(
  ctx: MutationCtx,
  {
    workspaceId,
    channelId,
    userId,
    name
  }: {
    workspaceId: Id<'workspaces'>
    channelId: Id<'channels'>
    userId: Id<'users'>
    name: string
  }
): Promise<void> {
  const seed = PAGE_SEEDS[name]
  if (!seed) return
  await ctx.db.insert('pages', {
    workspaceId,
    channelId,
    title: seed.title,
    content: toDoc(seed.blocks),
    updatedAt: Date.now(),
    updatedBy: userId
  })
}
