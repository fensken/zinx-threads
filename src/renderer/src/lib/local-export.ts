import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { useLocalStore, type LocalWorkspaceExport } from '@renderer/store/local-store'

/**
 * Export / import a local workspace as a **`.zip`**.
 *
 * The archive mirrors the on-disk folder layout (`workspace.json` + `pages/<id>.json`
 * + `boards/<id>.json` + `whiteboards/<id>.json`), so it's a portable backup you can
 * carry between devices, open in any archiver to see your files, and import back to
 * recreate the whole workspace. Importing always creates a **new** workspace with the
 * imported data (ids are remapped so it can't collide with anything you already have).
 *
 * This is a **local-mode-only** feature — it touches no server, the same reason local
 * mode exists.
 */

/** `workspace.json` inside the zip — identity + channel/group structure. The per-channel
 *  page/board/whiteboard content lives beside it as its own files. */
interface WorkspaceZipMeta {
  version: 1
  exportedAt: number
  workspace: { name: string; icon?: string; image?: string }
  channels: LocalWorkspaceExport['channels']
  groups: LocalWorkspaceExport['groups']
}

/** Read the store and gather one workspace's exportable slice. Null if it doesn't exist. */
export function collectWorkspaceExport(workspaceId: string): LocalWorkspaceExport | null {
  const state = useLocalStore.getState()
  const workspace = state.workspaces.find((w) => w.id === workspaceId)
  if (!workspace) return null

  const channels = state.channels.filter((c) => c.workspaceId === workspaceId)
  const pages: LocalWorkspaceExport['pages'] = {}
  const boards: LocalWorkspaceExport['boards'] = {}
  const whiteboards: LocalWorkspaceExport['whiteboards'] = {}
  for (const channel of channels) {
    if (state.pages[channel.id]) pages[channel.id] = state.pages[channel.id]
    if (state.boards[channel.id]) boards[channel.id] = state.boards[channel.id]
    if (state.whiteboards[channel.id]) whiteboards[channel.id] = state.whiteboards[channel.id]
  }

  return {
    version: 1,
    exportedAt: Date.now(),
    workspace: { name: workspace.name, icon: workspace.icon, image: workspace.image },
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      groupId: c.groupId,
      order: c.order,
      createdAt: c.createdAt
    })),
    groups: state.groups
      .filter((g) => g.workspaceId === workspaceId)
      .map((g) => ({ id: g.id, name: g.name, order: g.order })),
    pages,
    boards,
    whiteboards
  }
}

const pretty = (value: unknown): Uint8Array => strToU8(JSON.stringify(value, null, 2))

/** Serialize an export payload into a `.zip` (folder-mirroring, compressed). */
export function buildExportZip(payload: LocalWorkspaceExport): Uint8Array {
  const meta: WorkspaceZipMeta = {
    version: 1,
    exportedAt: payload.exportedAt,
    workspace: payload.workspace,
    channels: payload.channels,
    groups: payload.groups
  }
  const files: Record<string, Uint8Array> = { 'workspace.json': pretty(meta) }
  for (const [id, page] of Object.entries(payload.pages)) files[`pages/${id}.json`] = pretty(page)
  for (const [id, board] of Object.entries(payload.boards))
    files[`boards/${id}.json`] = pretty(board)
  for (const [id, wb] of Object.entries(payload.whiteboards)) {
    files[`whiteboards/${id}.json`] = pretty(wb)
  }
  return zipSync(files, { level: 6 })
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  )
}

/** Export a workspace to a downloaded `.zip`. Returns the filename, or null if the
 *  workspace couldn't be found. Works on web AND desktop (an anchor download). */
export function exportWorkspaceZip(workspaceId: string): string | null {
  const payload = collectWorkspaceExport(workspaceId)
  if (!payload) return null
  const zipped = buildExportZip(payload)
  const filename = `${slugify(payload.workspace.name)}.zip`
  // `as BlobPart[]`: the DOM lib's newer `ArrayBuffer` generics reject a plain
  // `Uint8Array<ArrayBufferLike>` here; the bytes are a valid Blob part.
  const url = URL.createObjectURL(new Blob([zipped] as BlobPart[], { type: 'application/zip' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return filename
}

/** Extract a workspace payload from an exported `.zip`. Null if it isn't one of ours
 *  (missing `workspace.json`, corrupt, wrong shape). */
export async function readWorkspaceZip(file: File): Promise<LocalWorkspaceExport | null> {
  try {
    const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()))
    const metaRaw = unzipped['workspace.json']
    if (!metaRaw) return null
    const meta = JSON.parse(strFromU8(metaRaw)) as WorkspaceZipMeta
    if (
      typeof meta?.workspace?.name !== 'string' ||
      !Array.isArray(meta.channels) ||
      !Array.isArray(meta.groups)
    ) {
      return null
    }

    const pages: LocalWorkspaceExport['pages'] = {}
    const boards: LocalWorkspaceExport['boards'] = {}
    const whiteboards: LocalWorkspaceExport['whiteboards'] = {}
    for (const [path, data] of Object.entries(unzipped)) {
      const match = path.match(/^(pages|boards|whiteboards)\/(.+)\.json$/)
      if (!match) continue
      const parsed = JSON.parse(strFromU8(data))
      if (match[1] === 'pages') pages[match[2]] = parsed
      else if (match[1] === 'boards') boards[match[2]] = parsed
      else whiteboards[match[2]] = parsed
    }

    return {
      version: 1,
      exportedAt: typeof meta.exportedAt === 'number' ? meta.exportedAt : Date.now(),
      workspace: meta.workspace,
      channels: meta.channels,
      groups: meta.groups,
      pages,
      boards,
      whiteboards
    }
  } catch {
    return null
  }
}
