import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { getChannelAccess, requireUser } from './lib/auth'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/**
 * Backend for **`database` channels** — an Airtable-style typed record set. Three tables
 * (`databaseFields` / `databaseRecords` / `databaseViews`), NOT a JSON blob, because
 * records are queried, sorted and reordered individually. Everything is gated on
 * `getChannelAccess` (so a private database channel is member-only) AND on
 * `channel.kind === 'database'`, the same way `pages`/`boards` gate their kind.
 */

const MAX_FIELDS = 50
const MAX_RECORDS = 5000
const MAX_VIEWS = 20
const MAX_OPTIONS = 100

const cellValue = v.union(v.string(), v.number(), v.boolean(), v.array(v.string()), v.null())

const fieldType = v.union(
  v.literal('text'),
  v.literal('longText'),
  v.literal('number'),
  v.literal('select'),
  v.literal('multiSelect'),
  v.literal('checkbox'),
  v.literal('date'),
  v.literal('user'),
  v.literal('url')
)

type FieldType = typeof fieldType.type

/** Which types a field can be CHANGED to (bidirectional within a family) — chosen so a
 *  conversion never silently corrupts stored cells:
 *  - the "text" family (text / long text / URL) are all plain strings,
 *  - select ↔ multi-select share option ids (values are migrated below).
 *  Everything else can't change type (number/checkbox/date/person stand alone). */
const STRINGY: FieldType[] = ['text', 'longText', 'url']
const CHOICE: FieldType[] = ['select', 'multiSelect']
function convertibleTo(from: FieldType): FieldType[] {
  if (STRINGY.includes(from)) return STRINGY
  if (CHOICE.includes(from)) return CHOICE
  return [from]
}

const optionInput = v.object({
  id: v.string(),
  label: v.string(),
  color: v.optional(v.string())
})

/** Resolve a database channel the caller may access, or throw. Returns the channel. */
async function requireDbChannel(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<'channels'>,
  userId: Id<'users'>
): Promise<Doc<'channels'>> {
  const access = await getChannelAccess(ctx, channelId, userId)
  if (!access) throw new ConvexError('Channel not found')
  if (access.channel.kind !== 'database') throw new ConvexError('Not a database channel')
  return access.channel
}

/** The whole database: fields + views + records, all in order. Null-safe (empty when
 *  the caller can't see the channel, so the UI shows an empty state rather than throwing). */
export const getByChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const user = await requireUser(ctx)
    const access = await getChannelAccess(ctx, channelId, user._id)
    if (!access || access.channel.kind !== 'database') return null

    const [fields, views, records] = await Promise.all([
      ctx.db
        .query('databaseFields')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .collect(),
      ctx.db
        .query('databaseViews')
        .withIndex('by_channel', (q) => q.eq('channelId', channelId))
        .collect(),
      ctx.db
        .query('databaseRecords')
        .withIndex('by_channel_order', (q) => q.eq('channelId', channelId))
        .take(MAX_RECORDS)
    ])
    return {
      fields: fields.sort((a, b) => a.order - b.order),
      views: views.sort((a, b) => a.order - b.order),
      records
    }
  }
})

// ── Fields ──────────────────────────────────────────────────────────────────

export const createField = mutation({
  args: {
    channelId: v.id('channels'),
    name: v.string(),
    type: fieldType,
    options: v.optional(v.array(optionInput))
  },
  handler: async (ctx, { channelId, name, type, options }) => {
    const user = await requireUser(ctx)
    await requireDbChannel(ctx, channelId, user._id)
    const existing = await ctx.db
      .query('databaseFields')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .collect()
    if (existing.length >= MAX_FIELDS) throw new ConvexError(`A table can have at most ${MAX_FIELDS} fields`)
    const clean = name.trim().slice(0, 100) || 'Field'
    return await ctx.db.insert('databaseFields', {
      channelId,
      name: clean,
      type,
      options: options?.slice(0, MAX_OPTIONS),
      order: existing.length
    })
  }
})

export const updateField = mutation({
  args: {
    fieldId: v.id('databaseFields'),
    name: v.optional(v.string()),
    type: v.optional(fieldType),
    options: v.optional(v.array(optionInput))
  },
  handler: async (ctx, { fieldId, name, type, options }) => {
    const user = await requireUser(ctx)
    const field = await ctx.db.get(fieldId)
    if (!field) throw new ConvexError('Field not found')
    await requireDbChannel(ctx, field.channelId, user._id)
    const patch: Partial<Doc<'databaseFields'>> = {}
    if (name !== undefined) patch.name = name.trim().slice(0, 100) || 'Field'
    if (options !== undefined) patch.options = options.slice(0, MAX_OPTIONS)

    if (type !== undefined && type !== field.type) {
      if (!convertibleTo(field.type).includes(type)) {
        throw new ConvexError(`A ${field.type} field can't be changed to ${type}`)
      }
      patch.type = type
      // Migrate stored cells only for the choice conversions (the string family needs none).
      const migrate =
        (field.type === 'select' && type === 'multiSelect') ||
        (field.type === 'multiSelect' && type === 'select')
      if (migrate) {
        const records = await ctx.db
          .query('databaseRecords')
          .withIndex('by_channel_order', (q) => q.eq('channelId', field.channelId))
          .take(MAX_RECORDS)
        const toMulti = type === 'multiSelect'
        for (const record of records) {
          const cell = record.values[fieldId as string]
          if (toMulti) {
            // select → multi: wrap a single option id in an array.
            if (typeof cell === 'string' && cell) {
              await ctx.db.patch(record._id, { values: { ...record.values, [fieldId]: [cell] } })
            }
          } else {
            // multi → select: keep the first chosen option (or clear).
            if (Array.isArray(cell)) {
              const next = { ...record.values }
              if (cell[0]) next[fieldId] = cell[0]
              else delete next[fieldId]
              await ctx.db.patch(record._id, { values: next })
            }
          }
        }
      }
    }
    await ctx.db.patch(fieldId, patch)
  }
})

export const deleteField = mutation({
  args: { fieldId: v.id('databaseFields') },
  handler: async (ctx, { fieldId }) => {
    const user = await requireUser(ctx)
    const field = await ctx.db.get(fieldId)
    if (!field) return
    await requireDbChannel(ctx, field.channelId, user._id)
    await ctx.db.delete(fieldId)
    // The field's cells become dead keys on each record; they're harmless (nothing
    // reads a key with no field) and left in place rather than rewriting every record.
  }
})

export const reorderFields = mutation({
  args: { channelId: v.id('channels'), fieldIds: v.array(v.id('databaseFields')) },
  handler: async (ctx, { channelId, fieldIds }) => {
    const user = await requireUser(ctx)
    await requireDbChannel(ctx, channelId, user._id)
    await Promise.all(
      fieldIds.map(async (id, index) => {
        const field = await ctx.db.get(id)
        if (field && field.channelId === channelId) await ctx.db.patch(id, { order: index })
      })
    )
  }
})

// ── Records ─────────────────────────────────────────────────────────────────

export const createRecord = mutation({
  args: {
    channelId: v.id('channels'),
    values: v.optional(v.record(v.string(), cellValue))
  },
  handler: async (ctx, { channelId, values }) => {
    const user = await requireUser(ctx)
    await requireDbChannel(ctx, channelId, user._id)
    const count = (
      await ctx.db
        .query('databaseRecords')
        .withIndex('by_channel_order', (q) => q.eq('channelId', channelId))
        .take(MAX_RECORDS)
    ).length
    if (count >= MAX_RECORDS) throw new ConvexError(`A table can hold at most ${MAX_RECORDS} records`)
    return await ctx.db.insert('databaseRecords', {
      channelId,
      values: values ?? {},
      order: count,
      createdBy: user._id,
      createdAt: Date.now()
    })
  }
})

/** Set one cell — the hot path, split out so a keystroke doesn't ship the whole row. */
export const updateCell = mutation({
  args: { recordId: v.id('databaseRecords'), fieldId: v.string(), value: cellValue },
  handler: async (ctx, { recordId, fieldId, value }) => {
    const user = await requireUser(ctx)
    const record = await ctx.db.get(recordId)
    if (!record) throw new ConvexError('Record not found')
    await requireDbChannel(ctx, record.channelId, user._id)
    const values = { ...record.values }
    if (value === null || value === '') delete values[fieldId]
    else values[fieldId] = value
    await ctx.db.patch(recordId, { values })
  }
})

export const deleteRecord = mutation({
  args: { recordId: v.id('databaseRecords') },
  handler: async (ctx, { recordId }) => {
    const user = await requireUser(ctx)
    const record = await ctx.db.get(recordId)
    if (!record) return
    await requireDbChannel(ctx, record.channelId, user._id)
    await ctx.db.delete(recordId)
  }
})

export const reorderRecords = mutation({
  args: { channelId: v.id('channels'), recordIds: v.array(v.id('databaseRecords')) },
  handler: async (ctx, { channelId, recordIds }) => {
    const user = await requireUser(ctx)
    await requireDbChannel(ctx, channelId, user._id)
    await Promise.all(
      recordIds.map(async (id, index) => {
        const record = await ctx.db.get(id)
        if (record && record.channelId === channelId) await ctx.db.patch(id, { order: index })
      })
    )
  }
})

/** Map an imported CSV cell to a stored value for a field's type. MIRRORS the renderer's
 *  `lib/database-import.ts` `mapImportedCell`; keep them in step. */
function mapImportedCell(
  field: Doc<'databaseFields'>,
  raw: string,
  nameToUser: Map<string, string>
): CellType | undefined {
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
      return nameToUser.get(value.toLowerCase())
    default:
      return value
  }
}

type CellType = string | number | boolean | string[] | null

/** Import CSV rows: resolve each header to an existing field (by name) or create a new TEXT
 *  field, then insert a record per row (values mapped by field type). Bounded by `MAX_FIELDS`
 *  and `MAX_RECORDS`; rows past the cap are reported as `skipped`. */
export const importRows = mutation({
  args: {
    channelId: v.id('channels'),
    headers: v.array(v.string()),
    rows: v.array(v.array(v.string()))
  },
  handler: async (ctx, { channelId, headers, rows }) => {
    const user = await requireUser(ctx)
    const channel = await requireDbChannel(ctx, channelId, user._id)

    const fields = await ctx.db
      .query('databaseFields')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .collect()

    // Resolve each header to a field, creating a text field for an unknown header (capped).
    let order = fields.length
    const headerFields: Array<Doc<'databaseFields'> | null> = []
    for (const header of headers) {
      const clean = header.trim()
      let field = fields.find((f) => f.name.toLowerCase() === clean.toLowerCase()) ?? null
      if (!field) {
        if (fields.length >= MAX_FIELDS) {
          headerFields.push(null) // no room for another field — this column is dropped
          continue
        }
        const id = await ctx.db.insert('databaseFields', {
          channelId,
          name: clean || 'Field',
          type: 'text',
          order: order++
        })
        field = await ctx.db.get(id)
        if (field) fields.push(field)
      }
      headerFields.push(field)
    }

    // Names → user ids, for `user` columns.
    const members = await ctx.db
      .query('workspaceMembers')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', channel.workspaceId))
      .collect()
    const nameToUser = new Map<string, string>()
    for (const m of members) {
      const u = await ctx.db.get(m.userId)
      if (u?.name) nameToUser.set(u.name.toLowerCase(), u._id as string)
    }

    let recordOrder = (
      await ctx.db
        .query('databaseRecords')
        .withIndex('by_channel_order', (q) => q.eq('channelId', channelId))
        .take(MAX_RECORDS)
    ).length
    let imported = 0
    for (const row of rows) {
      if (recordOrder >= MAX_RECORDS) break
      const values: Record<string, CellType> = {}
      headerFields.forEach((field, i) => {
        if (!field) return
        const mapped = mapImportedCell(field, row[i] ?? '', nameToUser)
        if (mapped !== undefined) values[field._id as string] = mapped
      })
      await ctx.db.insert('databaseRecords', {
        channelId,
        values,
        order: recordOrder++,
        createdBy: user._id,
        createdAt: Date.now()
      })
      imported += 1
    }
    return { imported, skipped: rows.length - imported }
  }
})

// ── Views ───────────────────────────────────────────────────────────────────

const viewType = v.union(
  v.literal('grid'),
  v.literal('kanban'),
  v.literal('calendar'),
  v.literal('gallery')
)

const viewConfig = v.object({
  groupByFieldId: v.optional(v.string()),
  sortFieldId: v.optional(v.string()),
  sortDir: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
  hiddenFieldIds: v.optional(v.array(v.string())),
  dateFieldId: v.optional(v.string())
})

export const createView = mutation({
  args: {
    channelId: v.id('channels'),
    name: v.string(),
    type: viewType,
    config: v.optional(viewConfig)
  },
  handler: async (ctx, { channelId, name, type, config }) => {
    const user = await requireUser(ctx)
    await requireDbChannel(ctx, channelId, user._id)
    const existing = await ctx.db
      .query('databaseViews')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .collect()
    if (existing.length >= MAX_VIEWS) throw new ConvexError(`A table can have at most ${MAX_VIEWS} views`)
    return await ctx.db.insert('databaseViews', {
      channelId,
      name: name.trim().slice(0, 60) || 'View',
      type,
      config,
      order: existing.length
    })
  }
})

export const updateView = mutation({
  args: {
    viewId: v.id('databaseViews'),
    name: v.optional(v.string()),
    config: v.optional(viewConfig)
  },
  handler: async (ctx, { viewId, name, config }) => {
    const user = await requireUser(ctx)
    const view = await ctx.db.get(viewId)
    if (!view) throw new ConvexError('View not found')
    await requireDbChannel(ctx, view.channelId, user._id)
    const patch: Partial<Doc<'databaseViews'>> = {}
    if (name !== undefined) patch.name = name.trim().slice(0, 60) || 'View'
    if (config !== undefined) patch.config = config
    await ctx.db.patch(viewId, patch)
  }
})

export const deleteView = mutation({
  args: { viewId: v.id('databaseViews') },
  handler: async (ctx, { viewId }) => {
    const user = await requireUser(ctx)
    const view = await ctx.db.get(viewId)
    if (!view) return
    await requireDbChannel(ctx, view.channelId, user._id)
    // Keep at least one view — a database with no view has nothing to render.
    const views = await ctx.db
      .query('databaseViews')
      .withIndex('by_channel', (q) => q.eq('channelId', view.channelId))
      .collect()
    if (views.length <= 1) throw new ConvexError('A table needs at least one view')
    await ctx.db.delete(viewId)
  }
})
