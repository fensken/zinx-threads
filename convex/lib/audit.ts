import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/**
 * The one writer for the enterprise audit trail (`auditLogs`). Every administrative
 * mutation that changes who-can-do-what, or destroys data, calls this so a compliance
 * team can answer "who did what, when" from a single append-only table.
 *
 * The `summary` is resolved by the CALLER at write time and stored verbatim — the
 * viewer never joins back to the (possibly since-deleted) target to render a row. That
 * is deliberate: an audit trail has to stay legible after the thing it describes is
 * gone. `targetId` is a plain string for the same reason (it can point at any table, or
 * at a row that no longer exists).
 *
 * Best-effort by contract: a failure to record MUST NOT fail the action it audits, so
 * callers `void recordAudit(...)` without awaiting the result for correctness. (We still
 * await the insert here; the caller decides whether to await the promise.)
 */
export async function recordAudit(
  ctx: MutationCtx,
  entry: {
    workspaceId: Id<'workspaces'>
    actorId: Id<'users'>
    action: string
    summary: string
    targetType?: string
    targetId?: string
  }
): Promise<void> {
  await ctx.db.insert('auditLogs', {
    workspaceId: entry.workspaceId,
    actorId: entry.actorId,
    action: entry.action,
    summary: entry.summary.slice(0, 500),
    targetType: entry.targetType,
    targetId: entry.targetId,
    createdAt: Date.now()
  })
}
