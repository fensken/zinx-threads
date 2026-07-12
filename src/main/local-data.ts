import { app, ipcMain, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

/**
 * File-backed storage for the OFFLINE workspaces (desktop only).
 *
 * Each offline workspace is its own folder under `userData/offline-workspaces/`:
 *
 *   offline-workspaces/
 *     profile.json                 — the device-local profile + current workspace
 *     <workspace-id>/
 *       workspace.json             — name, icon, channels, groups
 *       pages/<channel-id>.json    — one file per page (BlockNote document)
 *       boards/<channel-id>.json   — one file per board
 *
 * Workspaces are isolated: everything a workspace owns lives inside its folder, and
 * deleting the workspace deletes the folder. The renderer holds the data in memory
 * (Zustand) and syncs changed files through the narrow IPC surface below — no
 * renderer-supplied paths are ever trusted (ids and relative paths are whitelisted
 * by pattern, so `../` can never escape the root).
 */

const ROOT_DIR_NAME = 'offline-workspaces'

/** Workspace/channel ids are `crypto.randomUUID()`s — enforce that shape (plus a
 *  little slack) so a crafted id can't traverse the filesystem. */
const ID_RE = /^[a-zA-Z0-9-]{1,64}$/
/** The only files a workspace folder may contain. */
const REL_PATH_RE = /^(workspace\.json|(?:pages|boards)\/[a-zA-Z0-9-]{1,64}\.json)$/

function rootDir(): string {
  return path.join(app.getPath('userData'), ROOT_DIR_NAME)
}

interface OfflineWorkspaceFiles {
  id: string
  files: Record<string, string>
}

interface OfflineSnapshot {
  root: string | null
  workspaces: OfflineWorkspaceFiles[]
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

/** Read everything under the offline root — the renderer hydrates its store from
 *  this once per session. Corrupt/foreign files are skipped, never fatal. */
async function loadSnapshot(): Promise<OfflineSnapshot> {
  const root = rootDir()
  const snapshot: OfflineSnapshot = {
    root: await readFileOrNull(path.join(root, 'profile.json')),
    workspaces: []
  }

  let entries: import('fs').Dirent[] = []
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return snapshot // no folder yet — first run
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue
    const wsDir = path.join(root, entry.name)
    const workspaceJson = await readFileOrNull(path.join(wsDir, 'workspace.json'))
    if (workspaceJson === null) continue // not a workspace folder
    const files: Record<string, string> = { 'workspace.json': workspaceJson }

    for (const sub of ['pages', 'boards'] as const) {
      let names: string[] = []
      try {
        names = await fs.readdir(path.join(wsDir, sub))
      } catch {
        continue
      }
      for (const name of names) {
        const rel = `${sub}/${name}`
        if (!REL_PATH_RE.test(rel)) continue
        const content = await readFileOrNull(path.join(wsDir, sub, name))
        if (content !== null) files[rel] = content
      }
    }
    snapshot.workspaces.push({ id: entry.name, files })
  }
  return snapshot
}

/** The renderer's incremental save: only changed files cross the bridge.
 *  `root` — profile.json content (null = delete). Absent = unchanged.
 *  `workspaces[id]` — a map of relPath → content (null = delete file), or null to
 *  delete the whole workspace folder. */
interface OfflineSavePayload {
  root?: string | null
  workspaces?: Record<string, Record<string, string | null> | null>
}

async function applySave(payload: OfflineSavePayload): Promise<void> {
  const root = rootDir()
  await fs.mkdir(root, { recursive: true })

  if (payload.root !== undefined) {
    const profilePath = path.join(root, 'profile.json')
    if (payload.root === null) await fs.rm(profilePath, { force: true })
    else await fs.writeFile(profilePath, payload.root, 'utf8')
  }

  for (const [id, files] of Object.entries(payload.workspaces ?? {})) {
    if (!ID_RE.test(id)) continue
    const wsDir = path.join(root, id)

    if (files === null) {
      await fs.rm(wsDir, { recursive: true, force: true })
      continue
    }

    for (const [rel, content] of Object.entries(files)) {
      if (!REL_PATH_RE.test(rel)) continue
      const filePath = path.join(wsDir, ...rel.split('/'))
      if (content === null) {
        await fs.rm(filePath, { force: true })
      } else {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, content, 'utf8')
      }
    }
  }
}

export function registerLocalDataIpc(): void {
  ipcMain.handle('offline-data:load', () => loadSnapshot())

  ipcMain.handle('offline-data:save', async (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null) return false
    try {
      await applySave(payload as OfflineSavePayload)
      return true
    } catch (error) {
      console.error('[main] offline-data save failed:', error)
      return false
    }
  })

  // Reveal a workspace's folder (or the offline root) in the OS file manager. The
  // folder is created first so the affordance works even before the first save.
  ipcMain.handle('offline-data:open-folder', async (_event, workspaceId: unknown) => {
    let dir = rootDir()
    if (typeof workspaceId === 'string') {
      if (!ID_RE.test(workspaceId)) return null
      dir = path.join(dir, workspaceId)
    }
    try {
      await fs.mkdir(dir, { recursive: true })
      const error = await shell.openPath(dir)
      if (error) {
        console.error('[main] openPath failed:', error)
        return null
      }
      return dir
    } catch (error) {
      console.error('[main] offline-data open-folder failed:', error)
      return null
    }
  })
}
