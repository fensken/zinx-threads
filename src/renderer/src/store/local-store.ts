import { create } from 'zustand'
import {
  DEFAULT_BOARD_COLUMNS,
  type BoardColumn,
  type BoardOrder,
  type KanbanTask,
  type TaskFields
} from '@renderer/components/kanban/board-types'
import type {
  CellValue,
  DbField,
  DbFieldType,
  DbRecord,
  DbView
} from '@renderer/components/database/database-types'
import { mapImportedCell } from '@renderer/lib/database-import'

/**
 * The **offline workspace(s)** — standalone, no-auth, local-only workspaces. Mirrors
 * the live app (multiple workspaces + a switcher, an offline profile, per-workspace
 * grouped channels with drag-and-drop, search) minus everything that needs a server:
 * only `page` (docs) and `kanban` (boards) channel kinds, and no members / chat /
 * voice / unread / presence / sharing. Nothing here touches Convex.
 *
 * Persistence lives in `lib/local-data.ts` (NOT a zustand middleware): on desktop
 * each workspace is its own FOLDER on disk (`userData/offline-workspaces/<id>/` —
 * workspace.json + pages/*.json + boards/*.json, fully isolated per workspace); on
 * web it falls back to one localStorage blob. The store starts empty with
 * `hydrated: false` and is filled by `ensureLocalDataLoaded()`.
 */
export type LocalChannelKind = 'page' | 'kanban' | 'whiteboard' | 'database'

/** Sentinel bucket key for channels not in any group (mirrors the live sidebar). */
export const LOCAL_UNGROUPED = '__ungrouped__'

export interface LocalWorkspace {
  id: string
  name: string
  icon?: string
  /** A locally-picked logo, stored as a downscaled data URL (no upload). Takes
   *  priority over `icon` in `WorkspaceGlyph`, mirroring the online logo. */
  image?: string
  createdAt: number
}

/** The offline "you" — a purely local identity for the user bar (no account). */
export interface LocalProfile {
  name: string
  /** A locally-picked avatar, stored as a small downscaled data URL (no upload). */
  avatar?: string
}

export interface LocalChannel {
  id: string
  workspaceId: string
  name: string
  kind: LocalChannelKind
  /** Undefined = ungrouped (rendered above the groups). */
  groupId?: string
  /** Sort order within its bucket (ungrouped, or a group). */
  order: number
  createdAt: number
}

export interface LocalGroup {
  id: string
  workspaceId: string
  name: string
  order: number
}

/** A local page: the BlockNote document (JSON string) + its chrome. Keyed by channel id. */
export interface LocalPage {
  title?: string
  icon?: string
  cover?: string
  coverY?: number
  content?: string
}

export interface LocalBoard {
  columns: BoardColumn[]
}

/** The offline twin of a `database` channel — the same fields/records/views shape the
 *  Convex tables hold, keyed by channel id (like `pages`/`boards`/`whiteboards`). */
export interface LocalDatabase {
  fields: DbField[]
  records: DbRecord[]
  views: DbView[]
}

/** Persisted after a sidebar drag settles — the group order + each bucket's channels. */
export interface SidebarOrder {
  groupIds: string[]
  buckets: Record<string, string[]>
}

/** The canvas behind an offline `whiteboard` channel — the same shape the Convex
 *  `whiteboards` table holds, keyed by channel like `pages` and `boards`. */
export interface LocalWhiteboard {
  /** Excalidraw's element array, as JSON. */
  elements: string
  elementCount: number
  updatedAt: number
}

/**
 * A single local workspace serialized for **export / import** — its identity plus its
 * channels/groups (with their ORIGINAL ids, which `importWorkspace` remaps fresh) and
 * the per-channel page/board/whiteboard content keyed by channel id. This is the JSON
 * carried inside an exported `.zip` (see `lib/local-export.ts`).
 */
export interface LocalWorkspaceExport {
  version: 1
  exportedAt: number
  workspace: { name: string; icon?: string; image?: string }
  channels: Omit<LocalChannel, 'workspaceId'>[]
  groups: Omit<LocalGroup, 'workspaceId'>[]
  pages: Record<string, LocalPage>
  boards: Record<string, LocalBoard>
  whiteboards: Record<string, LocalWhiteboard>
  /** Optional so an export written before database channels existed still imports. */
  databases?: Record<string, LocalDatabase>
}

/** The persisted data slice (everything except `hydrated` + the actions) — what
 *  `lib/local-data.ts` reads/writes. */
export interface LocalData {
  workspaces: LocalWorkspace[]
  currentWorkspaceId: string | null
  profile: LocalProfile
  channels: LocalChannel[]
  groups: LocalGroup[]
  pages: Record<string, LocalPage>
  boards: Record<string, LocalBoard>
  whiteboards: Record<string, LocalWhiteboard>
  databases: Record<string, LocalDatabase>
}

interface LocalState extends LocalData {
  /** False until `ensureLocalDataLoaded()` fills the store (files on desktop,
   *  localStorage on web) — the offline shell shows a loading state until then. */
  hydrated: boolean

  createWorkspace: (name: string) => string
  renameWorkspace: (id: string, name: string) => void
  setWorkspaceIcon: (id: string, icon: string | undefined) => void
  setWorkspaceImage: (id: string, image: string | undefined) => void
  deleteWorkspace: (id: string) => void
  /** Create a NEW workspace from an exported one, remapping every id so it can never
   *  collide with existing local data. Returns the new workspace id + switches to it. */
  importWorkspace: (payload: LocalWorkspaceExport) => string
  setCurrentWorkspace: (id: string) => void
  setProfileName: (name: string) => void
  setProfileAvatar: (avatar: string | undefined) => void

  createChannel: (name: string, kind: LocalChannelKind, groupId?: string) => string
  renameChannel: (id: string, name: string) => void
  deleteChannel: (id: string) => void
  moveChannel: (id: string, groupId: string | undefined) => void

  createGroup: (name: string) => string
  renameGroup: (id: string, name: string) => void
  deleteGroup: (id: string) => void
  reorderSidebar: (order: SidebarOrder) => void

  saveWhiteboard: (channelId: string, scene: { elements: string; elementCount: number }) => void

  savePageContent: (channelId: string, content: string) => void
  savePageMeta: (
    channelId: string,
    patch: { title?: string; icon?: string | null; cover?: string | null; coverY?: number }
  ) => void

  createDbField: (
    channelId: string,
    input: { name: string; type: DbFieldType; options?: DbField['options'] }
  ) => void
  updateDbField: (
    channelId: string,
    fieldId: string,
    input: { name: string; type: DbFieldType; options?: DbField['options'] }
  ) => void
  deleteDbField: (channelId: string, fieldId: string) => void
  updateDbView: (channelId: string, viewId: string, config: DbView['config']) => void
  createDbView: (channelId: string, input: { name: string; type: DbView['type'] }) => void
  renameDbView: (channelId: string, viewId: string, name: string) => void
  deleteDbView: (channelId: string, viewId: string) => void
  createDbRecord: (channelId: string, values?: Record<string, CellValue>) => void
  updateDbCell: (channelId: string, recordId: string, fieldId: string, value: CellValue) => void
  deleteDbRecord: (channelId: string, recordId: string) => void
  importDbRows: (channelId: string, headers: string[], rows: string[][]) => void

  createColumn: (channelId: string, title: string) => void
  renameColumn: (channelId: string, columnId: string, title: string) => void
  deleteColumn: (channelId: string, columnId: string) => void
  seedDefaultColumns: (channelId: string) => void
  createTask: (channelId: string, columnId: string, fields: TaskFields) => void
  updateTask: (channelId: string, taskId: string, fields: TaskFields) => void
  deleteTask: (channelId: string, taskId: string) => void
  reorderBoard: (channelId: string, order: BoardOrder) => void
}

function uid(): string {
  return crypto.randomUUID()
}

function defaultColumns(): BoardColumn[] {
  return DEFAULT_BOARD_COLUMNS.map((title) => ({ id: uid(), title, tasks: [] }))
}

/** Seed a fresh local database — mirrors `convex/lib/databaseSeed.ts` (Name/Status/Notes
 *  + a Grid view and a Board view grouped by Status). */
function defaultDatabase(): LocalDatabase {
  const statusId = uid()
  return {
    fields: [
      { id: uid(), name: 'Name', type: 'text', order: 0 },
      {
        id: statusId,
        name: 'Status',
        type: 'select',
        options: [
          { id: 'todo', label: 'To do', color: '#94a3b8' },
          { id: 'doing', label: 'In progress', color: '#3b82f6' },
          { id: 'done', label: 'Done', color: '#22c55e' }
        ],
        order: 1
      },
      { id: uid(), name: 'Notes', type: 'text', order: 2 }
    ],
    records: [],
    views: [
      { id: uid(), name: 'Grid', type: 'grid', order: 0 },
      { id: uid(), name: 'Board', type: 'kanban', config: { groupByFieldId: statusId }, order: 1 }
    ]
  }
}

export const useLocalStore = create<LocalState>()((set) => ({
  workspaces: [],
  currentWorkspaceId: null,
  profile: { name: 'You' },
  channels: [],
  groups: [],
  pages: {},
  whiteboards: {},
  boards: {},
  databases: {},
  hydrated: false,

  createWorkspace: (name): string => {
    const id = uid()
    const trimmed = name.trim() || 'My workspace'
    set((state) => ({
      workspaces: [...state.workspaces, { id, name: trimmed, createdAt: Date.now() }],
      currentWorkspaceId: id
    }))
    return id
  },

  renameWorkspace: (id, name): void => {
    set((state) => ({
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === id ? { ...workspace, name: name.trim() || workspace.name } : workspace
      )
    }))
  },

  setWorkspaceIcon: (id, icon): void => {
    set((state) => ({
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === id ? { ...workspace, icon: icon ?? undefined } : workspace
      )
    }))
  },

  setWorkspaceImage: (id, image): void => {
    set((state) => ({
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === id ? { ...workspace, image: image ?? undefined } : workspace
      )
    }))
  },

  deleteWorkspace: (id): void => {
    set((state) => {
      const channelIds = new Set(
        state.channels.filter((c) => c.workspaceId === id).map((c) => c.id)
      )
      const pages = { ...state.pages }
      const boards = { ...state.boards }
      const whiteboards = { ...state.whiteboards }
      const databases = { ...state.databases }
      for (const channelId of channelIds) {
        delete pages[channelId]
        delete boards[channelId]
        delete whiteboards[channelId]
        delete databases[channelId]
      }
      const workspaces = state.workspaces.filter((w) => w.id !== id)
      return {
        workspaces,
        currentWorkspaceId:
          state.currentWorkspaceId === id ? (workspaces[0]?.id ?? null) : state.currentWorkspaceId,
        channels: state.channels.filter((c) => c.workspaceId !== id),
        groups: state.groups.filter((g) => g.workspaceId !== id),
        pages,
        boards,
        whiteboards,
        databases
      }
    })
  },

  importWorkspace: (payload): string => {
    const wsId = uid()
    // Remap group + channel ids so an imported workspace never collides with existing
    // local data — and carry each channel's page/board/whiteboard to its NEW id.
    const groupIdMap = new Map<string, string>()
    const groups: LocalGroup[] = payload.groups.map((group) => {
      const id = uid()
      groupIdMap.set(group.id, id)
      return { id, workspaceId: wsId, name: group.name, order: group.order }
    })
    const pages: Record<string, LocalPage> = {}
    const boards: Record<string, LocalBoard> = {}
    const whiteboards: Record<string, LocalWhiteboard> = {}
    const databases: Record<string, LocalDatabase> = {}
    const channels: LocalChannel[] = payload.channels.map((channel) => {
      const id = uid()
      if (payload.pages[channel.id]) pages[id] = payload.pages[channel.id]
      if (payload.boards[channel.id]) boards[id] = payload.boards[channel.id]
      if (payload.whiteboards[channel.id]) whiteboards[id] = payload.whiteboards[channel.id]
      if (payload.databases?.[channel.id]) databases[id] = payload.databases[channel.id]
      return {
        id,
        workspaceId: wsId,
        name: channel.name,
        kind: channel.kind,
        groupId: channel.groupId ? groupIdMap.get(channel.groupId) : undefined,
        order: channel.order,
        createdAt: channel.createdAt || Date.now()
      }
    })
    set((state) => ({
      workspaces: [
        ...state.workspaces,
        {
          id: wsId,
          name: payload.workspace.name.trim() || 'Imported workspace',
          icon: payload.workspace.icon,
          image: payload.workspace.image,
          createdAt: Date.now()
        }
      ],
      currentWorkspaceId: wsId,
      channels: [...state.channels, ...channels],
      groups: [...state.groups, ...groups],
      pages: { ...state.pages, ...pages },
      boards: { ...state.boards, ...boards },
      whiteboards: { ...state.whiteboards, ...whiteboards },
      databases: { ...state.databases, ...databases }
    }))
    return wsId
  },

  setCurrentWorkspace: (id): void => {
    set({ currentWorkspaceId: id })
  },

  setProfileName: (name): void => {
    set((state) => ({ profile: { ...state.profile, name: name.trim() || state.profile.name } }))
  },

  setProfileAvatar: (avatar): void => {
    set((state) => ({ profile: { ...state.profile, avatar: avatar ?? undefined } }))
  },

  createChannel: (name, kind, groupId): string => {
    const id = uid()
    const trimmed =
      name.trim() ||
      (kind === 'page'
        ? 'Untitled page'
        : kind === 'database'
          ? 'Untitled table'
          : 'Untitled board')
    set((state) => {
      const workspaceId = state.currentWorkspaceId
      if (!workspaceId) return {}
      return {
        channels: [
          ...state.channels,
          {
            id,
            workspaceId,
            name: trimmed,
            kind,
            groupId,
            order: state.channels.filter(
              (c) => c.workspaceId === workspaceId && c.groupId === groupId
            ).length,
            createdAt: Date.now()
          }
        ],
        boards:
          kind === 'kanban'
            ? { ...state.boards, [id]: { columns: defaultColumns() } }
            : state.boards,
        databases:
          kind === 'database' ? { ...state.databases, [id]: defaultDatabase() } : state.databases
      }
    })
    return id
  },

  renameChannel: (id, name): void => {
    set((state) => ({
      channels: state.channels.map((channel) =>
        channel.id === id ? { ...channel, name: name.trim() || channel.name } : channel
      )
    }))
  },

  deleteChannel: (id): void => {
    set((state) => {
      const pages = { ...state.pages }
      const boards = { ...state.boards }
      const whiteboards = { ...state.whiteboards }
      const databases = { ...state.databases }
      delete pages[id]
      delete boards[id]
      delete whiteboards[id]
      delete databases[id]
      return {
        channels: state.channels.filter((channel) => channel.id !== id),
        pages,
        boards,
        whiteboards,
        databases
      }
    })
  },

  moveChannel: (id, groupId): void => {
    set((state) => {
      const channel = state.channels.find((c) => c.id === id)
      if (!channel) return {}
      return {
        channels: state.channels.map((c) =>
          c.id === id
            ? {
                ...c,
                groupId,
                order: state.channels.filter(
                  (x) =>
                    x.workspaceId === channel.workspaceId && x.groupId === groupId && x.id !== id
                ).length
              }
            : c
        )
      }
    })
  },

  createGroup: (name): string => {
    const id = uid()
    const trimmed = name.trim()
    set((state) => {
      const workspaceId = state.currentWorkspaceId
      if (!trimmed || !workspaceId) return {}
      return {
        groups: [
          ...state.groups,
          {
            id,
            workspaceId,
            name: trimmed,
            order: state.groups.filter((g) => g.workspaceId === workspaceId).length
          }
        ]
      }
    })
    return id
  },

  renameGroup: (id, name): void => {
    set((state) => ({
      groups: state.groups.map((group) =>
        group.id === id ? { ...group, name: name.trim() || group.name } : group
      )
    }))
  },

  deleteGroup: (id): void => {
    // Remove the group but KEEP its channels — they move to the top, ungrouped.
    set((state) => ({
      groups: state.groups.filter((group) => group.id !== id),
      channels: state.channels.map((channel) =>
        channel.groupId === id ? { ...channel, groupId: undefined } : channel
      )
    }))
  },

  reorderSidebar: (order): void => {
    set((state) => {
      const groupOrder = new Map(order.groupIds.map((id, index) => [id, index]))
      const placement = new Map<string, { groupId: string | undefined; order: number }>()
      for (const [bucket, channelIds] of Object.entries(order.buckets)) {
        const groupId = bucket === LOCAL_UNGROUPED ? undefined : bucket
        channelIds.forEach((channelId, index) =>
          placement.set(channelId, { groupId, order: index })
        )
      }
      return {
        groups: state.groups.map((group) =>
          groupOrder.has(group.id)
            ? { ...group, order: groupOrder.get(group.id) ?? group.order }
            : group
        ),
        channels: state.channels.map((channel) => {
          const next = placement.get(channel.id)
          return next ? { ...channel, groupId: next.groupId, order: next.order } : channel
        })
      }
    })
  },

  saveWhiteboard: (channelId, scene): void => {
    set((state) => ({
      whiteboards: {
        ...state.whiteboards,
        [channelId]: {
          elements: scene.elements,
          elementCount: scene.elementCount,
          updatedAt: Date.now()
        }
      }
    }))
  },

  savePageContent: (channelId, content): void => {
    set((state) => ({
      pages: { ...state.pages, [channelId]: { ...state.pages[channelId], content } }
    }))
  },

  savePageMeta: (channelId, patch): void => {
    set((state) => {
      const current = state.pages[channelId] ?? {}
      const next: LocalPage = { ...current }
      if (patch.title !== undefined) next.title = patch.title
      if (patch.icon !== undefined) next.icon = patch.icon ?? undefined
      if (patch.cover !== undefined) next.cover = patch.cover ?? undefined
      if (patch.coverY !== undefined) next.coverY = patch.coverY
      return { pages: { ...state.pages, [channelId]: next } }
    })
  },

  createDbField: (channelId, input): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db) return {}
      const field: DbField = {
        id: uid(),
        name: input.name.trim().slice(0, 100) || 'Field',
        type: input.type,
        options: input.options,
        order: db.fields.length
      }
      return {
        databases: {
          ...state.databases,
          [channelId]: { ...db, fields: [...db.fields, field] }
        }
      }
    })
  },

  updateDbField: (channelId, fieldId, input): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db) return {}
      const field = db.fields.find((f) => f.id === fieldId)
      if (!field) return {}
      const prevType = field.type
      const nextType = input.type
      // Migrate cells only for the select↔multiSelect conversions (mirrors the backend).
      let records = db.records
      if (prevType === 'select' && nextType === 'multiSelect') {
        records = db.records.map((r) => {
          const cell = r.values[fieldId]
          if (typeof cell === 'string' && cell) {
            return { ...r, values: { ...r.values, [fieldId]: [cell] } }
          }
          return r
        })
      } else if (prevType === 'multiSelect' && nextType === 'select') {
        records = db.records.map((r) => {
          const cell = r.values[fieldId]
          if (Array.isArray(cell)) {
            const values = { ...r.values }
            if (cell[0]) values[fieldId] = cell[0]
            else delete values[fieldId]
            return { ...r, values }
          }
          return r
        })
      }
      return {
        databases: {
          ...state.databases,
          [channelId]: {
            ...db,
            records,
            fields: db.fields.map((f) =>
              f.id === fieldId
                ? {
                    ...f,
                    name: input.name.trim().slice(0, 100) || 'Field',
                    type: input.type,
                    options: input.options
                  }
                : f
            )
          }
        }
      }
    })
  },

  deleteDbField: (channelId, fieldId): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db) return {}
      return {
        databases: {
          ...state.databases,
          [channelId]: { ...db, fields: db.fields.filter((f) => f.id !== fieldId) }
        }
      }
    })
  },

  updateDbView: (channelId, viewId, config): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db) return {}
      return {
        databases: {
          ...state.databases,
          [channelId]: {
            ...db,
            views: db.views.map((v) => (v.id === viewId ? { ...v, config } : v))
          }
        }
      }
    })
  },

  createDbView: (channelId, input): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db) return {}
      const view: DbView = {
        id: uid(),
        name: input.name.trim().slice(0, 60) || 'View',
        type: input.type,
        order: db.views.length
      }
      return {
        databases: { ...state.databases, [channelId]: { ...db, views: [...db.views, view] } }
      }
    })
  },

  renameDbView: (channelId, viewId, name): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db) return {}
      return {
        databases: {
          ...state.databases,
          [channelId]: {
            ...db,
            views: db.views.map((v) =>
              v.id === viewId ? { ...v, name: name.trim().slice(0, 60) || 'View' } : v
            )
          }
        }
      }
    })
  },

  deleteDbView: (channelId, viewId): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db || db.views.length <= 1) return {}
      return {
        databases: {
          ...state.databases,
          [channelId]: { ...db, views: db.views.filter((v) => v.id !== viewId) }
        }
      }
    })
  },

  createDbRecord: (channelId, values): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db) return {}
      const record: DbRecord = { id: uid(), values: values ?? {}, order: db.records.length }
      return {
        databases: {
          ...state.databases,
          [channelId]: { ...db, records: [...db.records, record] }
        }
      }
    })
  },

  updateDbCell: (channelId, recordId, fieldId, value): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db) return {}
      return {
        databases: {
          ...state.databases,
          [channelId]: {
            ...db,
            records: db.records.map((record) => {
              if (record.id !== recordId) return record
              const nextValues = { ...record.values }
              if (value === null || value === '') delete nextValues[fieldId]
              else nextValues[fieldId] = value
              return { ...record, values: nextValues }
            })
          }
        }
      }
    })
  },

  deleteDbRecord: (channelId, recordId): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db) return {}
      return {
        databases: {
          ...state.databases,
          [channelId]: { ...db, records: db.records.filter((r) => r.id !== recordId) }
        }
      }
    })
  },

  importDbRows: (channelId, headers, rows): void => {
    set((state) => {
      const db = state.databases[channelId]
      if (!db) return {}
      const fields = [...db.fields]
      // Resolve each header to a field, creating a text field for an unknown header.
      const headerFields = headers.map((header) => {
        const clean = header.trim()
        let field = fields.find((f) => f.name.toLowerCase() === clean.toLowerCase())
        if (!field) {
          field = { id: uid(), name: clean || 'Field', type: 'text', order: fields.length }
          fields.push(field)
        }
        return field
      })
      // Local mode has no members, so `user` columns can't be matched.
      const newRecords: DbRecord[] = rows.map((row, index) => {
        const values: Record<string, CellValue> = {}
        headerFields.forEach((field, i) => {
          const mapped = mapImportedCell(field, row[i] ?? '', [])
          if (mapped !== undefined) values[field.id] = mapped
        })
        return { id: uid(), values, order: db.records.length + index }
      })
      return {
        databases: {
          ...state.databases,
          [channelId]: { ...db, fields, records: [...db.records, ...newRecords] }
        }
      }
    })
  },

  createColumn: (channelId, title): void => {
    set((state) => {
      const board = state.boards[channelId] ?? { columns: [] }
      return {
        boards: {
          ...state.boards,
          [channelId]: { columns: [...board.columns, { id: uid(), title, tasks: [] }] }
        }
      }
    })
  },

  renameColumn: (channelId, columnId, title): void => {
    set((state) => {
      const board = state.boards[channelId]
      if (!board) return {}
      return {
        boards: {
          ...state.boards,
          [channelId]: {
            columns: board.columns.map((column) =>
              column.id === columnId ? { ...column, title } : column
            )
          }
        }
      }
    })
  },

  deleteColumn: (channelId, columnId): void => {
    set((state) => {
      const board = state.boards[channelId]
      if (!board) return {}
      return {
        boards: {
          ...state.boards,
          [channelId]: { columns: board.columns.filter((column) => column.id !== columnId) }
        }
      }
    })
  },

  seedDefaultColumns: (channelId): void => {
    set((state) => {
      const board = state.boards[channelId]
      if (board && board.columns.length > 0) return {}
      return { boards: { ...state.boards, [channelId]: { columns: defaultColumns() } } }
    })
  },

  createTask: (channelId, columnId, fields): void => {
    set((state) => {
      const board = state.boards[channelId]
      if (!board) return {}
      const task: KanbanTask = { id: uid(), ...fields }
      return {
        boards: {
          ...state.boards,
          [channelId]: {
            columns: board.columns.map((column) =>
              column.id === columnId ? { ...column, tasks: [...column.tasks, task] } : column
            )
          }
        }
      }
    })
  },

  updateTask: (channelId, taskId, fields): void => {
    set((state) => {
      const board = state.boards[channelId]
      if (!board) return {}
      return {
        boards: {
          ...state.boards,
          [channelId]: {
            columns: board.columns.map((column) => ({
              ...column,
              tasks: column.tasks.map((task) =>
                task.id === taskId ? { ...task, ...fields, id: taskId } : task
              )
            }))
          }
        }
      }
    })
  },

  deleteTask: (channelId, taskId): void => {
    set((state) => {
      const board = state.boards[channelId]
      if (!board) return {}
      return {
        boards: {
          ...state.boards,
          [channelId]: {
            columns: board.columns.map((column) => ({
              ...column,
              tasks: column.tasks.filter((task) => task.id !== taskId)
            }))
          }
        }
      }
    })
  },

  reorderBoard: (channelId, order): void => {
    set((state) => {
      const board = state.boards[channelId]
      if (!board) return {}
      const taskById = new Map(
        board.columns.flatMap((column) => column.tasks.map((task) => [task.id, task] as const))
      )
      // Guard against dropping tasks omitted from the incoming order.
      const incoming = new Set(Object.values(order.taskIdsByColumn).flat())
      if (incoming.size !== taskById.size) return {}
      const columnById = new Map(board.columns.map((column) => [column.id, column]))
      const columns: BoardColumn[] = order.columnIds.map((columnId) => ({
        id: columnId,
        title: columnById.get(columnId)?.title ?? 'Column',
        tasks: (order.taskIdsByColumn[columnId] ?? [])
          .map((taskId) => taskById.get(taskId))
          .filter((task): task is KanbanTask => Boolean(task))
      }))
      return { boards: { ...state.boards, [channelId]: { columns } } }
    })
  }
}))

/** The active offline workspace, or null. */
export function useCurrentLocalWorkspace(): LocalWorkspace | null {
  return useLocalStore(
    (state) => state.workspaces.find((w) => w.id === state.currentWorkspaceId) ?? null
  )
}
