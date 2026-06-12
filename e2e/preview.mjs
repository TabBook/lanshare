// Phase-6: thumbnails & fullscreen preview — lazy thumbs in the timeline,
// lightbox shows the original only on demand, arrow navigation between
// adjacent images, Esc closes, video renders inline with Range support.
import { execSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:18080'
const TOKEN = 't0ken'
const auth = { Authorization: `Bearer ${TOKEN}` }

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Upload three small PNGs + one fake video via the API.
async function uploadFile(name, buf, mime) {
  const init = await fetch(`${BASE}/api/uploads`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name, size: buf.length, mime }),
  }).then((r) => r.json())
  await fetch(`${BASE}/api/uploads/${init.upload_id}/chunks/0`, {
    method: 'PUT', headers: auth, body: buf,
  })
  return fetch(`${BASE}/api/uploads/${init.upload_id}/complete`, {
    method: 'POST', headers: auth,
  }).then((r) => r.json())
}

// tiny valid PNGs in three colors via Go-generated /tmp/test.png? Build pixels with zlib here instead.
import { deflateSync } from 'node:zlib'
function png(r, g, b, w = 64, h = 64) {
  const crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c
  }
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

const ts = Date.now()
const m1 = await uploadFile(`红-${ts}.png`, png(220, 60, 60), 'image/png')
const m2 = await uploadFile(`绿-${ts}.png`, png(60, 180, 90), 'image/png')
const m3 = await uploadFile(`蓝-${ts}.png`, png(60, 90, 220), 'image/png')
check('three images uploaded', !!(m1.file_id && m2.file_id && m3.file_id))
const vid = await uploadFile(`视频-${ts}.mp4`, Buffer.alloc(4096), 'video/mp4')
check('video message created', vid.type === 'video')

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.goto(BASE)
await page.evaluate(async (token) => {
  localStorage.setItem('token', token)
  const r = await fetch('/api/devices', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: '预览测试机' }),
  }).then((r) => r.json())
  localStorage.setItem('device_id', r.device_id)
  localStorage.setItem('device_name', r.name)
}, TOKEN)
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('textarea')
await sleep(600)

// --- timeline thumbnails ---
const thumbInfo = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('main img')]
  return imgs.map((i) => ({ src: i.src, lazy: i.loading, w: i.width, h: i.height }))
})
check('timeline shows thumbnails (not originals)', thumbInfo.length >= 3 &&
  thumbInfo.every((t) => t.src.includes('/thumb')), JSON.stringify(thumbInfo.slice(0, 2)))
check('thumbs are lazy with fixed dims', thumbInfo.every((t) => t.lazy === 'lazy' && t.w > 0 && t.h > 0))

// --- no original requested before opening lightbox ---
const origReqs = []
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('/api/files/') && !u.includes('/thumb')) origReqs.push(u)
})

// click the green (middle) image
await page.evaluate((fid) => {
  ;[...document.querySelectorAll('main img')].find((i) => i.src.includes(fid))?.click()
}, m2.file_id)
await sleep(700)
const lightboxImg = await page.evaluate(() => {
  const img = document.querySelector('.fixed.z-50 img')
  return img ? img.src : null
})
check('lightbox shows original', !!lightboxImg && lightboxImg.includes(m2.file_id) && !lightboxImg.includes('/thumb'))
check('original fetched only for lightbox', origReqs.length === 1, `reqs=${origReqs.length}`)

// --- arrow navigation ---
await page.keyboard.press('ArrowLeft')
await sleep(400)
const prevImg = await page.evaluate(() => document.querySelector('.fixed.z-50 img')?.src)
check('left arrow -> previous image', !!prevImg && prevImg.includes(m1.file_id))
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
await sleep(400)
const nextImg = await page.evaluate(() => document.querySelector('.fixed.z-50 img')?.src)
check('right arrow x2 -> next image', !!nextImg && nextImg.includes(m3.file_id))

// counter like 2/3
const counter = await page.evaluate(() => document.querySelector('.fixed.z-50')?.innerText || '')
check('position counter shown', /\d+\/\d+/.test(counter))

await page.keyboard.press('Escape')
await sleep(300)
check('Esc closes lightbox', await page.evaluate(() => !document.querySelector('.fixed.z-50 img')))

// --- video placeholder & inline playback ---
const vidName = `视频-${ts}.mp4`
const hasPlaceholder = await page.evaluate((name) => {
  return [...document.querySelectorAll('main button')].some(
    (b) => b.innerText.includes(name) && b.querySelector('svg'),
  )
}, vidName)
check('video shows play placeholder (no thumbnail)', hasPlaceholder)
await page.evaluate((name) => {
  ;[...document.querySelectorAll('main button')].find((b) => b.innerText.includes(name))?.click()
}, vidName)
await sleep(500)
const videoEl = await page.evaluate(() => {
  const v = document.querySelector('main video')
  return v ? { src: v.src, controls: v.controls } : null
})
check('inline <video> with direct file src', !!videoEl && videoEl.src.includes(vid.file_id) && videoEl.controls)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
