import type { CellValue, DbField, DbMember } from '@renderer/components/database/database-types'

/**
 * Map one imported CSV cell (a string) to the stored cell value for a field's type. Returns
 * `undefined` when the cell is empty or can't be matched (e.g. a select value with no such
 * option). MIRRORS the backend's mapping in `convex/database.ts importRows` — keep the two
 * in step. Used by the offline (local-store) import; the online path re-implements it
 * server-side (renderer code can't run in Convex).
 */
export function mapImportedCell(
  field: DbField,
  raw: string,
  members: DbMember[]
): CellValue | undefined {
  const value = raw.trim()
  if (!value) return undefined
  switch (field.type) {
    case 'number': {
      const n = Number(value)
      return Number.isNaN(n) ? undefined : n
    }
    case 'checkbox':
      return /^(yes|true|1|x|✓|checked)$/i.test(value)
    case 'select':
      return field.options?.find((o) => o.label.toLowerCase() === value.toLowerCase())?.id
    case 'multiSelect': {
      const ids = value
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(
          (label) => field.options?.find((o) => o.label.toLowerCase() === label.toLowerCase())?.id
        )
        .filter((id): id is string => Boolean(id))
      return ids.length ? ids : undefined
    }
    case 'user':
      return members.find((m) => m.name.toLowerCase() === value.toLowerCase())?.userId
    default:
      // text / longText / url / date — store the string as-is.
      return value
  }
}
