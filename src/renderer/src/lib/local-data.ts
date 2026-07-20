import { toast } from 'sonner'
import {
  isElectron,
  platform,
  type OfflineSavePayload,
  type OfflineSnapshot
} from '@renderer/lib/platform'
import {
  useLocalStore,
  type LocalBoard,
  type LocalChannel,
  type LocalData,
  type LocalDatabase,
  type LocalGroup,
  type LocalWhiteboard,
  type LocalPage,
  type LocalWorkspace
} from '@renderer/store/local-store'

/**
 * Persistence for the offline workspaces.
 *
 * Desktop: **one folder per workspace** on disk (`userData/offline-workspaces/<id>/`
 * — `workspace.json` + `pages/<channelId>.json` + `boards/<channelId>.json`), fully
 * isolated from each other, plus a root `profile.json` (device profile + current
 * workspace). The store is hydrated from the folders once, then every change is
 * debounced and only the files whose content actually changed are rewritten
 * (deleting a workspace deletes its folder). Files are pretty-printed JSON, since
 * "open the folder" is a real affordance and people will read them.
 *
 * Web: no filesystem — one localStorage blob (`zinx-local`, the same envelope the
 * old zustand-persist wrote, so existing data loads unchanged).
 *
 * A desktop app that previously saved to localStorage is migrated once: if no
 * folders exist but the localStorage blob does, it's imported, written to folders,
 * and the blob is removed.
 */

const LEGACY_KEY = 'zinx-local'
const FLUSH_DELAY = 400

function emptyData(): LocalData {
  return {
    workspaces: [],
    currentWorkspaceId: null,
    profile: { name: 'You' },
    channels: [],
    groups: [],
    pages: {},
    boards: {},
    whiteboards: {},
    databases: {}
  }
}

function dataOf(): LocalData {
  const s = useLocalStore.getState()
  return {
    workspaces: s.workspaces,
    currentWorkspaceId: s.currentWorkspaceId,
    profile: s.profile,
    channels: s.channels,
    groups: s.groups,
    pages: s.pages,
    boards: s.boards,
    whiteboards: s.whiteboards,
    databases: s.databases
  }
}

function tryParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Legacy localStorage blob — the web persistence format AND the pre-folder
// desktop format (read for the one-time migration).
// ---------------------------------------------------------------------------

interface LegacyV0 {
  channels?: Omit<LocalChannel, 'workspaceId'>[]
  groups?: Omit<LocalGroup, 'workspaceId'>[]
  pages?: Record<string, LocalPage>
  boards?: Record<string, LocalBoard>
}

function readLegacy(): LocalData | null {
  const parsed = tryParse<Record<string, unknown>>(localStorage.getItem(LEGACY_KEY))
  if (!parsed) return null
  // zustand-persist wrote an `{ state, version }` envelope; accept bare state too.
  const state = (
    typeof parsed.state === 'object' && parsed.state !== null ? parsed.state : parsed
  ) as Partial<LocalData> & LegacyV0

  if (Array.isArray(state.workspaces)) {
    return { ...emptyData(), ...state, workspaces: state.workspaces }
  }
  // v0 (before multi-workspace): wrap any data into a default workspace.
  const hasData = Boolean(state.channels?.length || state.groups?.length)
  if (!hasData) return null
  const workspaceId = crypto.randomUUID()
  return {
    workspaces: [{ id: workspaceId, name: 'My workspace', createdAt: Date.now() }],
    currentWorkspaceId: workspaceId,
    profile: { name: 'You' },
    channels: (state.channels ?? []).map((channel) => ({ ...channel, workspaceId })),
    groups: (state.groups ?? []).map((group) => ({ ...group, workspaceId })),
    pages: state.pages ?? {},
    boards: state.boards ?? {},
    // v0 predates whiteboards + databases entirely — there are none to carry over.
    whiteboards: {},
    databases: {}
  }
}

function writeLegacy(data: LocalData): void {
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ state: data, version: 1 }))
  } catch {
    // localStorage is the ONLY copy on web — never swallow a failed write.
    toast.error('This device is out of storage — recent offline changes weren’t saved.', {
      id: 'offline-storage-full'
    })
  }
}

// ---------------------------------------------------------------------------
// Folder-backed persistence (desktop).
// ---------------------------------------------------------------------------

/** What a `workspace.json` holds — the workspace's identity + its channel/group
 *  structure. Pages/boards live beside it as their own files. */
interface WorkspaceFileJson {
  id: string
  name: string
  icon?: string
  image?: string
  createdAt: number
  channels: Omit<LocalChannel, 'workspaceId'>[]
  groups: Omit<LocalGroup, 'workspaceId'>[]
}

function parseSnapshot(snapshot: OfflineSnapshot): LocalData {
  const data = emptyData()

  const root = tryParse<{ profile?: LocalData['profile']; currentWorkspaceId?: string | null }>(
    snapshot.root
  )
  if (root?.profile?.name) data.profile = { name: root.profile.name, avatar: root.profile.avatar }
  if (root?.currentWorkspaceId !== undefined) data.currentWorkspaceId = root.currentWorkspaceId

  for (const ws of snapshot.workspaces) {
    const meta = tryParse<WorkspaceFileJson>(ws.files['workspace.json'])
    if (!meta) {
      console.error(`[offline] skipping workspace ${ws.id}: corrupt workspace.json`)
      continue
    }
    const workspace: LocalWorkspace = {
      id: ws.id, // the folder name is authoritative
      name: typeof meta.name === 'string' && meta.name.trim() ? meta.name : 'Workspace',
      icon: typeof meta.icon === 'string' ? meta.icon : undefined,
      image: typeof meta.image === 'string' ? meta.image : undefined,
      createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : Date.now()
    }
    data.workspaces.push(workspace)
    for (const channel of Array.isArray(meta.channels) ? meta.channels : []) {
      data.channels.push({ ...channel, workspaceId: ws.id })
    }
    for (const group of Array.isArray(meta.groups) ? meta.groups : []) {
      data.groups.push({ ...group, workspaceId: ws.id })
    }
    for (const [rel, content] of Object.entries(ws.files)) {
      const match = rel.match(/^(pages|boards|whiteboards|databases)\/(.+)\.json$/)
      if (!match) continue
      const parsed = tryParse<LocalPage & LocalBoard & LocalWhiteboard & LocalDatabase>(content)
      if (!parsed) {
        console.error(`[offline] skipping corrupt file ${ws.id}/${rel}`)
        continue
      }
      // All are keyed by the CHANNEL's id — the file name IS the channel id.
      if (match[1] === 'pages') data.pages[match[2]] = parsed
      else if (match[1] === 'whiteboards') data.whiteboards[match[2]] = parsed
      else if (match[1] === 'databases') data.databases[match[2]] = parsed
      else data.boards[match[2]] = parsed
    }
  }

  // The remembered current workspace may have been deleted on disk.
  if (!data.workspaces.some((w) => w.id === data.currentWorkspaceId)) {
    data.currentWorkspaceId = data.workspaces[0]?.id ?? null
  }
  return data
}

function rootFileOf(data: LocalData): string {
  return JSON.stringify(
    { profile: data.profile, currentWorkspaceId: data.currentWorkspaceId },
    null,
    2
  )
}

/** The canonical on-disk file set for the current data — keys `<wsId>/<relPath>`. */
function buildFileMap(data: LocalData): Map<string, string> {
  const map = new Map<string, string>()
  for (const ws of data.workspaces) {
    const channels = data.channels.filter((c) => c.workspaceId === ws.id)
    const groups = data.groups.filter((g) => g.workspaceId === ws.id)
    const meta: WorkspaceFileJson = {
      id: ws.id,
      name: ws.name,
      icon: ws.icon,
      image: ws.image,
      createdAt: ws.createdAt,
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        groupId: c.groupId,
        order: c.order,
        createdAt: c.createdAt
      })),
      groups: groups.map((g) => ({ id: g.id, name: g.name, order: g.order }))
    }
    map.set(`${ws.id}/workspace.json`, JSON.stringify(meta, null, 2))
    for (const channel of channels) {
      const page = data.pages[channel.id]
      if (page) map.set(`${ws.id}/pages/${channel.id}.json`, JSON.stringify(page, null, 2))
      const board = data.boards[channel.id]
      if (board) map.set(`${ws.id}/boards/${channel.id}.json`, JSON.stringify(board, null, 2))
      const whiteboard = data.whiteboards[channel.id]
      if (whiteboard) {
        map.set(`${ws.id}/whiteboards/${channel.id}.json`, JSON.stringify(whiteboard, null, 2))
      }
      const database = data.databases[channel.id]
      if (database) {
        map.set(`${ws.id}/databases/${channel.id}.json`, JSON.stringify(database, null, 2))
      }
    }
  }
  return map
}

let lastFiles = new Map<string, string>()
let lastRoot: string | null = null

function splitKey(key: string): [string, string] {
  const slash = key.indexOf('/')
  return [key.slice(0, slash), key.slice(slash + 1)]
}

/** Diff the current store against what's on disk and write only the changes. */
async function flushToDisk(): Promise<void> {
  const data = dataOf()
  const files = buildFileMap(data)
  const root = rootFileOf(data)

  const payload: OfflineSavePayload = {}
  if (root !== lastRoot) payload.root = root

  const workspaces: NonNullable<OfflineSavePayload['workspaces']> = {}
  const liveIds = new Set(data.workspaces.map((w) => w.id))

  // Deleted workspaces first (whole folder), then per-file deletes, then writes.
  for (const key of lastFiles.keys()) {
    if (files.has(key)) continue
    const [wsId, rel] = splitKey(key)
    if (!liveIds.has(wsId)) {
      workspaces[wsId] = null
      continue
    }
    const entry = (workspaces[wsId] ??= {})
    if (entry) entry[rel] = null
  }
  for (const [key, content] of files) {
    if (lastFiles.get(key) === content) continue
    const [wsId, rel] = splitKey(key)
    const entry = (workspaces[wsId] ??= {})
    if (entry) entry[rel] = content
  }

  if (Object.keys(workspaces).length) payload.workspaces = workspaces
  if (payload.root === undefined && !payload.workspaces) return

  const ok = await platform.offlineData.save(payload)
  if (ok) {
    lastFiles = files
    lastRoot = root
  } else {
    toast.error('Couldn’t save offline changes to disk.', { id: 'offline-fs-save' })
  }
}

// One flush at a time; a change arriving mid-flush queues exactly one more.
let flushTimer: ReturnType<typeof setTimeout> | undefined
let flushing: Promise<void> | null = null
let flushQueued = false

async function runFlush(): Promise<void> {
  if (flushing) {
    flushQueued = true
    await flushing
    return
  }
  const run = flushToDisk()
  flushing = run
  try {
    await run
  } finally {
    flushing = null
    if (flushQueued) {
      flushQueued = false
      scheduleFlush()
    }
  }
}

function scheduleFlush(): void {
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void runFlush(), FLUSH_DELAY)
}

/**
 * Everything with an unflushed debounce that must reach the store before we save.
 *
 * The editors debounce their writes to the *store* (600ms for a page's content), and
 * a debounce only flushes on unmount — but closing a window fires `pagehide` and
 * **never unmounts React**. So the newest keystrokes were sitting in a timer that was
 * about to be destroyed with the window, while the "flush on quit" path dutifully
 * persisted the older state and reported success. Anything that debounces into the
 * offline store registers here so `flushOfflineNow` can drain it first.
 */
const pendingWrites = new Set<() => void>()

export function registerOfflineFlush(flush: () => void): () => void {
  pendingWrites.add(flush)
  return () => pendingWrites.delete(flush)
}

/**
 * Save everything, now — the on-the-way-out path.
 *
 * Three things had to be true and weren't: the editors' debounces must be drained
 * into the store first; a flush already in flight must be **awaited** rather than
 * re-queued behind a 400ms timer that a closing window will never fire; and the disk
 * write must run **inline** rather than being scheduled.
 */
export async function flushOfflineNow(): Promise<void> {
  clearTimeout(flushTimer)
  for (const write of pendingWrites) {
    try {
      write()
    } catch {
      // One editor failing to flush must not stop the others from saving.
    }
  }
  if (flushing) await flushing
  await runFlush()
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

let started = false

/** Hydrate the offline store (idempotent) — called on mount of the `/local` shell.
 *  Desktop: read the workspace folders (migrating a legacy localStorage blob once);
 *  web: read the localStorage blob. Then subscribe the persistence writer. */
export function ensureLocalDataLoaded(): void {
  if (started) return
  started = true

  if (platform.offlineData.isFileBacked()) {
    void initDesktop()
    return
  }

  // **On desktop, never fall back to localStorage.** The route lets `/local` through
  // on a UA check (`isElectron`), but the storage check is `Boolean(window.api)` — and
  // a preload that throws exposes nothing (a real, previously-shipped failure mode; see
  // CLAUDE.md). Falling back would hydrate an EMPTY store, show the user zero
  // workspaces while their folders sit intact on disk, and then quietly write their
  // re-done work to localStorage where the next healthy launch would never look for it.
  // Refusing to hydrate is the honest failure: the data stays where it is.
  if (isElectron) {
    toast.error('Offline storage is unavailable — restart the app.', {
      id: 'offline-bridge-missing',
      duration: Infinity
    })
    return
  }

  initWeb()
}

function initWeb(): void {
  const data = readLegacy() ?? emptyData()
  useLocalStore.setState({ ...data, hydrated: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  useLocalStore.subscribe(() => {
    clearTimeout(timer)
    timer = setTimeout(() => writeLegacy(dataOf()), 300)
  })
  // localStorage is synchronous, so the last keystrokes can be saved on the way out.
  window.addEventListener('pagehide', () => {
    clearTimeout(timer)
    writeLegacy(dataOf())
  })
}

async function initDesktop(): Promise<void> {
  const snapshot = await platform.offlineData.load()
  const fromDisk = snapshot ? parseSnapshot(snapshot) : emptyData()

  // One-time migration: folders empty but the old localStorage blob has data.
  let migrated = false
  let data = fromDisk
  if (fromDisk.workspaces.length === 0) {
    const legacy = readLegacy()
    if (legacy && legacy.workspaces.length > 0) {
      data = legacy
      migrated = true
    }
  }

  useLocalStore.setState({ ...data, hydrated: true })

  if (migrated) {
    // lastFiles is empty, so this writes every folder; only then drop the blob.
    await flushToDisk()
    if (lastRoot !== null) localStorage.removeItem(LEGACY_KEY)
  } else {
    // Seed the diff baseline with the canonical form of what we just read, so the
    // first change rewrites only its own file, not everything.
    lastFiles = buildFileMap(data)
    lastRoot = rootFileOf(data)
  }

  useLocalStore.subscribe(scheduleFlush)
  // On the way out: drain the editors' debounces into the store, then write inline.
  // Main holds the quit until the write lands (`before-quit` in src/main/local-data.ts)
  // — without that, `app.quit()` raced the very write it had just been handed.
  window.addEventListener('pagehide', () => {
    void flushOfflineNow()
  })
}
