import { cp, mkdir, rm, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Copy Excalidraw's fonts into the renderer's `public/` dir, so we serve them ourselves.
 *
 * **Excalidraw fetches its fonts from the unpkg CDN unless you tell it otherwise** —
 * `window.EXCALIDRAW_ASSET_PATH` (set in `main.tsx`) points it at our own origin instead.
 * Two reasons that matters, and the first is a hard blocker:
 *
 *  1. **Our CSP forbids it.** `font-src 'self' data:` — a CDN font is simply blocked, and
 *     Excalidraw's text rendering fails with it. Widening the CSP to allow unpkg would be
 *     the wrong trade: it's a script-adjacent third-party origin, for fonts we already have
 *     on disk.
 *  2. **The desktop app must work offline.** A whiteboard that needs the network to draw
 *     text isn't offline-capable, and `/local` exists precisely to be.
 *
 * Run before dev + both builds (see package.json). The output is git-ignored — it's a copy
 * of a dependency, not source.
 */
// `require.resolve('@excalidraw/excalidraw/package.json')` doesn't work — the package's
// `exports` map doesn't expose it. Go through the symlink pnpm leaves in `node_modules`
// and resolve it to the real path in the store.
const root = resolve(import.meta.dirname, '..')
const pkgDir = await realpath(join(root, 'node_modules', '@excalidraw', 'excalidraw'))
const from = join(pkgDir, 'dist', 'prod', 'fonts')
const to = join(root, 'src', 'renderer', 'public', 'fonts')

if (!existsSync(from)) {
  console.error(`[excalidraw] fonts not found at ${from} — did the package layout change?`)
  process.exit(1)
}

await rm(to, { recursive: true, force: true })
await mkdir(to, { recursive: true })
await cp(from, to, { recursive: true })
console.log(`[excalidraw] fonts → ${to}`)
