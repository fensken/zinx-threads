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
/** The subfolders a workspace may contain. **Adding a new kind of offline document
 *  means adding it HERE** — the renderer writing a path this doesn't know about used
 *  to be silently dropped (see `applySave`), which is exactly how offline diagrams
 *  shipped writing to a path main refused, losing every drawing on quit. */
const SUB_DIRS = ['pages', 'boards', 'whiteboards', 'databases'] as const

/** The only files a workspace folder may contain. Also the path-traversal guard:
 *  no `.` or `/` is allowed inside a name, so a crafted id can't escape the root. */
const REL_PATH_RE =
  /^(workspace\.json|(?:pages|boards|whiteboards|databases)\/[a-zA-Z0-9-]{1,64}\.json)$/

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

    for (const sub of SUB_DIRS) {
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

/**
 * Write a file so that a crash can never leave a **half-written** one.
 *
 * `fs.writeFile` opens with `O_TRUNC`: it empties the existing file and then streams
 * the new bytes. Interrupt it — the process is quitting, the machine loses power —
 * and the user's page is now 0 bytes or half a JSON document. Their old, good copy is
 * already gone.
 *
 * So: write a temp file beside it, `fsync` it (the bytes are actually on the platter,
 * not just in the OS cache), then **rename over the target** — an atomic operation on
 * NTFS and POSIX alike. At every instant the real file is either entirely the old
 * content or entirely the new one.
 */
async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, filePath)
}

async function applySave(payload: OfflineSavePayload): Promise<void> {
  const root = rootDir()
  await fs.mkdir(root, { recursive: true })

  if (payload.root !== undefined) {
    const profilePath = path.join(root, 'profile.json')
    if (payload.root === null) await fs.rm(profilePath, { force: true })
    else await writeFileAtomic(profilePath, payload.root)
  }

  for (const [id, files] of Object.entries(payload.workspaces ?? {})) {
    if (!ID_RE.test(id)) throw new Error(`offline save: bad workspace id ${id}`)
    const wsDir = path.join(root, id)

    if (files === null) {
      await fs.rm(wsDir, { recursive: true, force: true })
      continue
    }

    for (const [rel, content] of Object.entries(files)) {
      // **Throw, don't skip.** A silently-ignored path is how offline diagrams once shipped
      // writing to `diagrams/…` while this regex only knew `pages|boards`: every save
      // reported success, the renderer committed its "already saved" baseline, and
      // every drawing was lost on quit with nothing in the logs. A path we don't
      // recognise is a bug in *us*, and it must be loud.
      if (!REL_PATH_RE.test(rel)) throw new Error(`offline save: unknown path ${rel}`)
      const filePath = path.join(wsDir, ...rel.split('/'))
      if (content === null) await fs.rm(filePath, { force: true })
      else await writeFileAtomic(filePath, content)
    }
  }
}

/** In-flight save, so quitting can wait for it (see `registerLocalDataIpc`). */
let pendingSave: Promise<void> | null = null

export function registerLocalDataIpc(): void {
  ipcMain.handle('offline-data:load', () => loadSnapshot())

  ipcMain.handle('offline-data:save', async (_event, payload: unknown) => {
    if (typeof payload !== 'object' || payload === null) return false
    const save = applySave(payload as OfflineSavePayload)
    pendingSave = save.then(
      () => undefined,
      () => undefined
    )
    try {
      await save
      return true
    } catch (error) {
      console.error('[main] offline-data save failed:', error)
      return false
    } finally {
      pendingSave = null
    }
  })

  // **Hold the quit for an in-flight save.** The renderer's last-chance flush fires
  // from `pagehide` and is fire-and-forget — it relies on main outliving the window.
  // But `window-all-closed` calls `app.quit()` on the very next tick, so without this
  // the process can exit *mid-write* of the file it was asked to save on the way out:
  // the last thing you typed before closing is the thing most likely to be lost, and
  // (before `writeFileAtomic`) it took the previous good copy with it.
  app.on('before-quit', (event) => {
    if (!pendingSave) return
    event.preventDefault()
    void pendingSave.finally(() => {
      pendingSave = null
      app.quit()
    })
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
