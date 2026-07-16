// Propagates the Zinx Threads brand logo to every icon/asset surface from ONE master file:
// `resources/logo.png` (a 1024×1024 PNG). Re-run whenever the logo changes:
//   node scripts/generate-icon.mjs
//
// Fans the master out to:
//   • build/icon.png                    — electron-builder's source (it makes icon.ico/.icns)
//   • resources/icon.png                — the Linux window / runtime icon
//   • src/renderer/src/assets/logo.png  — imported by the in-app <Logo> (a module, so the URL
//                                         resolves under the packaged file:// renderer)
//   • src/renderer/public/logo.png      — the web favicon (served at /logo.png)
//
// (This used to draw a rose squircle + white "Z" with a pure-Node PNG encoder; it now just copies
// the real brand image at the master path — still no native deps, works offline.)
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const master = resolve(root, 'resources/logo.png')

if (!existsSync(master)) {
  console.error(`Master logo not found at ${master} — drop a 1024x1024 PNG there first.`)
  process.exit(1)
}

const targets = [
  'build/icon.png',
  'resources/icon.png',
  'src/renderer/src/assets/logo.png',
  'src/renderer/public/logo.png'
]

for (const rel of targets) {
  const dest = resolve(root, rel)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(master, dest)
  console.log(`✓ ${rel}`)
}
console.log('Logo propagated. Rebuild to pick it up (build:win / build:mac / build:linux).')
