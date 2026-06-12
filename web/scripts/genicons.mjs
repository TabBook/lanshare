// Generate PNG app icons (rounded clay square + white share glyph) without
// any native image dependency: write raw RGBA and encode PNG by hand via zlib.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const CLAY = [0xd9, 0x77, 0x57]

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function dist(px, py, ax, ay, bx, by) {
  // point-to-segment distance
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const s = size / 100 // design coords are 0..100
  const r = 22 * s
  const nodes = [
    [32 * s, 50 * s],
    [66 * s, 32 * s],
    [66 * s, 68 * s],
  ]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // rounded-rect coverage
      const cx = Math.max(r, Math.min(size - r, x + 0.5))
      const cy = Math.max(r, Math.min(size - r, y + 0.5))
      const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r
      if (!inside) continue
      let [R, G, B] = CLAY
      // white glyph: 2 segments + 3 circles
      const lw = 3 * s
      const onLine =
        dist(x, y, nodes[0][0], nodes[0][1], nodes[1][0], nodes[1][1]) < lw ||
        dist(x, y, nodes[0][0], nodes[0][1], nodes[2][0], nodes[2][1]) < lw
      const onNode = nodes.some(([nx, ny]) => Math.hypot(x - nx, y - ny) < 9 * s)
      if (onLine || onNode) [R, G, B] = [255, 255, 255]
      rgba[i] = R
      rgba[i + 1] = G
      rgba[i + 2] = B
      rgba[i + 3] = 255
    }
  }
  return encodePNG(size, rgba)
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), makeIcon(size))
  console.log(`icon-${size}.png`)
}
