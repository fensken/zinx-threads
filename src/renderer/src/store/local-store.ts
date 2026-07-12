import { create } from 'zustand'
import {
  DEFAULT_BOARD_COLUMNS,
  type BoardColumn,
  type BoardOrder,
  type KanbanTask,
  type TaskFields
} from '@renderer/components/kanban/board-types'

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
export type LocalChannelKind = 'page' | 'kanban'

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

/** Persisted after a sidebar drag settles — the group order + each bucket's channels. */
export interface SidebarOrder {
  groupIds: string[]
  buckets: Record<string, string[]>
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

  savePageContent: (channelId: string, content: string) => void
  savePageMeta: (
    channelId: string,
    patch: { title?: string; icon?: string | null; cover?: string | null; coverY?: number }
  ) => void

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

export const useLocalStore = create<LocalState>()((set) => ({
  workspaces: [],
  currentWorkspaceId: null,
  profile: { name: 'You' },
  channels: [],
  groups: [],
  pages: {},
  boards: {},
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
      for (const channelId of channelIds) {
        delete pages[channelId]
        delete boards[channelId]
      }
      const workspaces = state.workspaces.filter((w) => w.id !== id)
      return {
        workspaces,
        currentWorkspaceId:
          state.currentWorkspaceId === id ? (workspaces[0]?.id ?? null) : state.currentWorkspaceId,
        channels: state.channels.filter((c) => c.workspaceId !== id),
        groups: state.groups.filter((g) => g.workspaceId !== id),
        pages,
        boards
      }
    })
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
    const trimmed = name.trim() || (kind === 'page' ? 'Untitled page' : 'Untitled board')
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
            : state.boards
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
      delete pages[id]
      delete boards[id]
      return { channels: state.channels.filter((channel) => channel.id !== id), pages, boards }
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
