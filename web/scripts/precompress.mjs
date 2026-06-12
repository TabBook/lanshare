// Precompress build output so the Go server can serve .gz directly without
// runtime compression. Tiny files and already-compressed formats are skipped.
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const exts = ['.js', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt']

async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p)
    else if (exts.some((x) => e.name.endsWith(x))) {
      const data = await fs.readFile(p)
      if (data.length < 1024) continue
      const gz = gzipSync(data, { level: 9 })
      if (gz.length < data.length * 0.9) await fs.writeFile(p + '.gz', gz)
    }
  }
}
await walk(new URL('../dist', import.meta.url).pathname)
console.log('precompress done')
