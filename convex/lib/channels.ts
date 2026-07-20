import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/** The kinds that are actually *channels* — everything a workspace lists in its
 *  sidebar. Deliberately NOT `dm`: a DM is a channel row, but it belongs to its two
 *  participants, not to the workspace. */
export const CHANNEL_KINDS = [
  'chat',
  'voice',
  'page',
  'kanban',
  'whiteboard',
  'database',
  'form'
] as const

/**
 * Every channel in a workspace, **excluding DMs**, reading only the rows it returns.
 *
 * The obvious version of this — `by_workspace` + `.collect()` + `.filter(c => c.kind
 * !== 'dm')` — is a scaling trap, and it was in five places. DM rows live in the same
 * table and grow with the *square* of the member count (one per conversation pair),
 * so in a workspace of 500 people a few thousand DM documents sit in that index. Every
 * one of them was read, and thrown away, by queries that run on **every connected
 * member's client** and re-run on **every message** — `listBySlug`, `resolveBySlug`,
 * `unread.listByWorkspace`. That's the difference between a workspace query costing
 * ~20 documents and costing ~3,000.
 *
 * One range per kind reads only the rows we want. Four index ranges is a rounding
 * error next to the documents they save, and it needs no new field and no backfill
 * (unlike an `isDm` flag, where an unbackfilled DM row would have `isDm: undefined`
 * and so match the "not a DM" range — i.e. fail *open*, leaking private conversations
 * into the sidebar).
 */
export async function listRealChannels(
  ctx: QueryCtx,
  workspaceId: Id<'workspaces'>
): Promise<Doc<'channels'>[]> {
  const perKind = await Promise.all(
    CHANNEL_KINDS.map((kind) =>
      ctx.db
        .query('channels')
        .withIndex('by_workspace_kind', (q) => q.eq('workspaceId', workspaceId).eq('kind', kind))
        .collect()
    )
  )
  return perKind.flat().sort((a, b) => a.order - b.order)
}
