// Propagates the Zinx Threads brand logo to every icon/asset surface from ONE master file:
// `resources/logo.png` (a 1024×1024 PNG). Re-run whenever the logo changes:
//   node scripts/generate-icon.mjs
//
// Each surface gets a size that fits its job (a 1024² PNG served as a 16px favicon is ~1.3 MB down
// the wire for nothing), resized here in pure Node — decode/encode via the built-in `zlib`, so
// there are NO native deps and it works offline (the same reason the old "rose Z" generator
// hand-rolled its PNG encoder). The master stays 1024² so electron-builder still has a large source.
//
// A non-square master is padded onto a transparent square canvas first (icons must be square), and
// nothing is upscaled — `resize` only downscales cleanly — so the build icon is capped to the
// largest standard size the master can fill 1:1. Give it a ≥1024² PNG for the crispest icons.
//
// Fans the master out to:
//   • build/icon.png                    (≤1024) — electron-builder's source; it makes icon.ico/.icns
//                                                 from this at package time (Windows taskbar + dock)
//   • resources/icon.png                (≤512)  — the Linux window / runtime icon + the tray source
//   • src/renderer/src/assets/logo.png  (256)   — imported by the in-app <Logo> (a module, so the URL
//                                                 resolves under the packaged file:// renderer)
//   • src/renderer/public/logo.png      (256)   — a general web logo served at /logo.png
//   • src/renderer/public/apple-touch-icon.png (180) — iOS / macOS "add to home screen"
//   • src/renderer/public/favicon-32.png (32) + favicon-16.png (16) — the browser tab favicon
//
// The master must be a 24/32-bit (RGB/RGBA), 8-bit-per-channel, non-interlaced PNG — what every
// design tool exports by default. If you feed it something exotic the decoder throws with why.
import zlib from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const masterPath = resolve(root, 'resources/logo.png')

if (!existsSync(masterPath)) {
  console.error(`Master logo not found at ${masterPath} — drop a 1024x1024 PNG there first.`)
  process.exit(1)
}

// ── PNG codec (8-bit, RGB/RGBA, non-interlaced) ──────────────────────────────

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/** Decode a PNG to `{ width, height, data }` where `data` is RGBA (4 bytes/pixel). */
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG')
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  let offset = 8
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const bitDepth = data[8]
      colorType = data[9]
      const interlace = data[12]
      if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
        throw new Error(
          `unsupported PNG (need 8-bit RGB/RGBA, non-interlaced; got bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace})`
        )
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  const srcChannels = colorType === 6 ? 4 : 3
  const stride = width * srcChannels
  const inflated = zlib.inflateSync(Buffer.concat(idat))
  const rgba = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)]
    const rowStart = y * (stride + 1) + 1
    const cur = Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const raw = inflated[rowStart + x]
      const a = x >= srcChannels ? cur[x - srcChannels] : 0
      const b = prev[x]
      const c = x >= srcChannels ? prev[x - srcChannels] : 0
      let value
      switch (filter) {
        case 0:
          value = raw
          break
        case 1:
          value = raw + a
          break
        case 2:
          value = raw + b
          break
        case 3:
          value = raw + ((a + b) >> 1)
          break
        case 4:
          value = raw + paeth(a, b, c)
          break
        default:
          throw new Error(`bad scanline filter ${filter}`)
      }
      cur[x] = value & 0xff
    }
    // Expand to RGBA (opaque alpha for a 3-channel source).
    for (let x = 0; x < width; x++) {
      const s = x * srcChannels
      const d = (y * width + x) * 4
      rgba[d] = cur[s]
      rgba[d + 1] = cur[s + 1]
      rgba[d + 2] = cur[s + 2]
      rgba[d + 3] = srcChannels === 4 ? cur[s + 3] : 255
    }
    prev = cur
  }
  return { width, height, data: rgba }
}

/** Box-average downscale, alpha-premultiplied so transparent edges don't darken. */
function resize({ width: sw, height: sh, data: sd }, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4)
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor((dy * sh) / dh)
    const sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * sh) / dh))
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor((dx * sw) / dw)
      const sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * sw) / dw))
      let r = 0
      let g = 0
      let b = 0
      let alpha = 0
      let count = 0
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const i = (y * sw + x) * 4
          const af = sd[i + 3]
          r += sd[i] * af
          g += sd[i + 1] * af
          b += sd[i + 2] * af
          alpha += af
          count++
        }
      }
      const d = (dy * dw + dx) * 4
      if (alpha > 0) {
        out[d] = Math.round(r / alpha)
        out[d + 1] = Math.round(g / alpha)
        out[d + 2] = Math.round(b / alpha)
        out[d + 3] = Math.round(alpha / count)
      }
    }
  }
  return { width: dw, height: dh, data: out }
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** Pad an image onto a transparent SQUARE canvas (side = the longer edge), centred. Icons must be
 *  square; padding keeps the mark's aspect ratio (stretching a near-square logo to a square would
 *  visibly squish it). A no-op when the source is already square. */
function toSquare({ width, height, data }) {
  if (width === height) return { width, height, data }
  const side = Math.max(width, height)
  const out = Buffer.alloc(side * side * 4) // zero-filled = transparent
  const ox = Math.floor((side - width) / 2)
  const oy = Math.floor((side - height) / 2)
  for (let y = 0; y < height; y++) {
    data.copy(out, ((y + oy) * side + ox) * 4, y * width * 4, y * width * 4 + width * 4)
  }
  return { width: side, height: side, data: out }
}

/** Encode `{ width, height, data(RGBA) }` back to a PNG buffer (filter 0 per row). */
function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: None
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ── Fan-out ──────────────────────────────────────────────────────────────────

const decoded = decodePng(readFileSync(masterPath))
if (decoded.width !== decoded.height) {
  console.log(`ℹ master is ${decoded.width}×${decoded.height} — padding to a square canvas.`)
}
// Every surface is square. `resize` only downscales cleanly (upscaling would go blocky), so the
// build icon is capped to the largest standard size the master can fill 1:1 — for a crisp result,
// give this script a ≥1024² square master.
const master = toSquare(decoded)
if (master.width < 512) {
  console.warn(`⚠ master is only ${master.width}px — icons will look soft. Prefer a ≥1024² PNG.`)
}
const iconSize = master.width >= 1024 ? 1024 : master.width >= 512 ? 512 : master.width

function write(rel, buffer) {
  const dest = resolve(root, rel)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, buffer)
  console.log(`✓ ${rel}`)
}

// build/icon.png is electron-builder's source; it downsizes this into every icon size itself, so
// it gets the largest square the master can fill without upscaling.
const targets = [
  ['build/icon.png', iconSize],
  ['resources/icon.png', Math.min(512, iconSize)],
  ['src/renderer/src/assets/logo.png', 256],
  ['src/renderer/public/logo.png', 256],
  ['src/renderer/public/apple-touch-icon.png', 180],
  ['src/renderer/public/favicon-32.png', 32],
  ['src/renderer/public/favicon-16.png', 16]
]
for (const [rel, size] of targets) {
  write(rel, encodePng(resize(master, size, size)))
}

console.log('Logo propagated. Rebuild to pick it up (build:win / build:mac / build:linux).')
