/**
 * Structural, data-source-agnostic types for the Database views. The presentational
 * Grid/Board components take these (keyed on a plain `id`), so BOTH the online adapter
 * (`real-database-view.tsx`, mapping Convex `_id`→`id`) and the offline adapter
 * (`local/local-database-view.tsx`, reading the local store) render through the same
 * components — the same "one look, two data sources" split `PageEditor`/`BoardView` use.
 */
export type DbFieldType =
  'text' | 'longText' | 'number' | 'select' | 'multiSelect' | 'checkbox' | 'date' | 'user' | 'url'

export type CellValue = string | number | boolean | string[] | null

export interface DbFieldOption {
  id: string
  label: string
  color?: string
}

export interface DbField {
  id: string
  name: string
  type: DbFieldType
  options?: DbFieldOption[]
  order: number
}

export interface DbRecord {
  id: string
  values: Record<string, CellValue>
  order: number
}

export interface DbViewConfig {
  groupByFieldId?: string
  sortFieldId?: string
  sortDir?: 'asc' | 'desc'
  hiddenFieldIds?: string[]
  dateFieldId?: string
}

export interface DbView {
  id: string
  name: string
  type: 'grid' | 'kanban' | 'calendar' | 'gallery'
  config?: DbViewConfig
  order: number
}

/** A workspace member, for `user`-type fields. */
export type DbMember = {
  userId: string
  name: string
  color?: string
  avatarUrl?: string | null
}

export const FIELD_TYPE_LABEL: Record<DbFieldType, string> = {
  text: 'Text',
  longText: 'Long text',
  number: 'Number',
  select: 'Select',
  multiSelect: 'Multi-select',
  checkbox: 'Checkbox',
  date: 'Date',
  user: 'Person',
  url: 'URL'
}

export const FIELD_TYPES: DbFieldType[] = [
  'text',
  'longText',
  'number',
  'select',
  'multiSelect',
  'checkbox',
  'date',
  'user',
  'url'
]

/** Which types a field can be CHANGED to, mirroring the backend's `convertibleTo`
 *  (string family text/longText/url; select ↔ multiSelect; everything else stands alone). */
const STRINGY_TYPES: DbFieldType[] = ['text', 'longText', 'url']
const CHOICE_TYPES: DbFieldType[] = ['select', 'multiSelect']
export function convertibleTypes(from: DbFieldType): DbFieldType[] {
  if (STRINGY_TYPES.includes(from)) return STRINGY_TYPES
  if (CHOICE_TYPES.includes(from)) return CHOICE_TYPES
  return [from]
}

/** select/multiSelect need options. */
export function typeNeedsOptions(type: DbFieldType): boolean {
  return type === 'select' || type === 'multiSelect'
}

/** A cell's human-readable text — for search and default display. Resolves select/user
 *  ids to their labels/names so searching "Done" or a person's name works. */
export function cellText(field: DbField, value: CellValue, members: DbMember[]): string {
  if (value === null || value === undefined) return ''
  if (field.type === 'checkbox') return value === true ? 'yes' : 'no'
  if (field.type === 'select') return field.options?.find((o) => o.id === value)?.label ?? ''
  if (field.type === 'multiSelect' && Array.isArray(value)) {
    // Drop ids whose option was removed — never surface a raw id as searchable/sortable text.
    return value
      .map((v) => field.options?.find((o) => o.id === v)?.label)
      .filter((label): label is string => Boolean(label))
      .join(' ')
  }
  if (field.type === 'user') return members.find((m) => m.userId === value)?.name ?? ''
  return String(value)
}

/** Compare two records' cells for a field, for column sorting. */
export function compareCells(
  field: DbField,
  a: CellValue,
  b: CellValue,
  members: DbMember[]
): number {
  if (field.type === 'number') {
    const na = typeof a === 'number' ? a : Number.NEGATIVE_INFINITY
    const nb = typeof b === 'number' ? b : Number.NEGATIVE_INFINITY
    return na - nb
  }
  if (field.type === 'checkbox') return (a === true ? 1 : 0) - (b === true ? 1 : 0)
  return cellText(field, a, members).localeCompare(cellText(field, b, members))
}

/** A palette for auto-assigning a colour to a new select option (categorical — like the
 *  avatar swatches, these are DATA colours, not theme accents, so they're literal on
 *  purpose). */
export const OPTION_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899'
]
