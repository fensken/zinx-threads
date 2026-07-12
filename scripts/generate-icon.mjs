// Generates the Zinx Threads app icon from the same shapes as the SVG favicon —
// a rose squircle with a white "Z" — using pure Node (SDF anti-aliasing + a
// minimal PNG encoder). No native deps (sharp/resvg aren't reliably installable
// here). Writes a 1024×1024 PNG to BOTH resources/icon.png (the Linux window /
// runtime icon) and build/icon.png (electron-builder's source — it regenerates
// the packaged icon.ico / icon.icns from this at build time, which is why those
// scaffold files are deleted). Re-run if the logo changes:
//   node scripts/generate-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const S = 1024 // icon size
const R = 0.2 * S // corner radius (matches the favicon squircle)
const ROSE = [225, 29, 72] // #e11d48 (brand primary)
const WHITE = [255, 255, 255]

// "Z" geometry, scaled from the 32-unit favicon viewBox.
const f = S / 32
const HALF = 1.3 * f // half stroke width
const seg = (ax, ay, bx, by) => [ax * f, ay * f, bx * f, by * f]
const Z = [seg(11, 11.5, 21, 11.5), seg(21, 11.5, 11, 20.5), seg(11, 20.5, 21, 20.5)]

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
// Signed distance to a rounded box centered at origin, half-extent b, radius r.
function sdRoundBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r
  const qy = Math.abs(py) - by + r
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}
// Distance from point to segment.
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
  return Math.hypot(pax - bax * h, pay - bay * h)
}

const cx = S / 2
const cy = S / 2
const raw = Buffer.alloc(S * (S * 4 + 1)) // scanlines: 1 filter byte + RGBA per row

for (let y = 0; y < S; y++) {
  const rowStart = y * (S * 4 + 1)
  raw[rowStart] = 0 // filter: none
  for (let x = 0; x < S; x++) {
    const px = x + 0.5 - cx
    const py = y + 0.5 - cy
    // Background squircle coverage (analytic AA over ~1px).
    const dBox = sdRoundBox(px, py, S / 2, S / 2, R)
    const bg = smoothstep(0.8, -0.8, dBox)
    // "Z" coverage.
    let dz = Infinity
    for (const [ax, ay, bx, by] of Z) {
      dz = Math.min(dz, sdSegment(x + 0.5, y + 0.5, ax, ay, bx, by) - HALF)
    }
    const z = smoothstep(0.8, -0.8, dz)
    // Composite: white "Z" over rose, all clipped to the squircle alpha.
    const r = ROSE[0] * (1 - z) + WHITE[0] * z
    const g = ROSE[1] * (1 - z) + WHITE[1] * z
    const b = ROSE[2] * (1 - z) + WHITE[2] * z
    const o = rowStart + 1 + x * 4
    raw[o] = Math.round(r)
    raw[o + 1] = Math.round(g)
    raw[o + 2] = Math.round(b)
    raw[o + 3] = Math.round(bg * 255)
  }
}

// ── Minimal PNG encoder (8-bit RGBA) ────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type: RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const rel of ['resources/icon.png', 'build/icon.png']) {
  const out = resolve(rootDir, rel)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, png)
  console.log(`Wrote ${rel} (${S}x${S}, ${png.length} bytes)`)
}
