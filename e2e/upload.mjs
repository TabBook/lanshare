// Phase-4: upload pipeline through the real UI — file picker, multi-chunk
// concurrency, progress UI, paste intake, and resume via localStorage
// fingerprint after an interrupted upload.
import { execSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:18080'
const TOKEN = 't0ken'
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

execSync('dd if=/dev/urandom of=/tmp/e2e-20mb.bin bs=1M count=20 2>/dev/null')
execSync('cp /tmp/test.png /tmp/e2e-img.png 2>/dev/null || dd if=/dev/urandom of=/tmp/e2e-img.png bs=1k count=4 2>/dev/null')

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

// login via localStorage (device already registered in smoke test? register fresh)
await page.goto(BASE)
await page.evaluate(async (token) => {
  localStorage.setItem('token', token)
  const r = await fetch('/api/devices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '上传测试机' }),
  }).then((r) => r.json())
  localStorage.setItem('device_id', r.device_id)
  localStorage.setItem('device_name', r.name)
}, TOKEN)
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('textarea')

// --- 1. multi-chunk upload via file picker, watch progress + chunk PUTs ---
const putUrls = []
page.on('request', (r) => r.method() === 'PUT' && putUrls.push(r.url()))

const input = await page.$('input[type=file]')
await input.uploadFile('/tmp/e2e-20mb.bin')
await sleep(300)
const progressShown = await page.evaluate(() => document.body.innerText.includes('e2e-20mb.bin'))
check('progress card appears', progressShown)

// wait for completion (file message in timeline)
let done = false
for (let i = 0; i < 60 && !done; i++) {
  await sleep(500)
  done = await page.evaluate(() =>
    [...document.querySelectorAll('a[download]')].some((a) => a.innerText.includes('e2e-20mb.bin')),
  )
}
check('file message appears after complete', done)
check('uploaded in 3 chunks', putUrls.filter((u) => u.includes('/chunks/')).length === 3,
  `puts=${putUrls.length}`)

// verify bytes server-side
const list = await fetch(`${BASE}/api/messages?q=e2e-20mb&limit=5`, { headers: auth }).then((r) => r.json())
const fileMsg = list.messages[0]
check('server has the file message', !!fileMsg && fileMsg.file_size === 20 * 1024 * 1024)
if (fileMsg) {
  execSync(`curl -s "${BASE}/api/files/${fileMsg.file_id}?token=${TOKEN}" -o /tmp/e2e-down.bin`)
  const same = (() => {
    try { execSync('cmp /tmp/e2e-20mb.bin /tmp/e2e-down.bin'); return true } catch { return false }
  })()
  check('downloaded bytes identical', same)
}

// --- 2. resume: interrupt mid-upload, re-pick same file, must reuse upload_id ---
// Throttle uploads to 4MB/s so the 40MB file takes ~10s and we can interrupt.
execSync('dd if=/dev/urandom of=/tmp/e2e-40mb.bin bs=1M count=40 2>/dev/null')
const cdp = await page.createCDPSession()
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: 2, downloadThroughput: -1, uploadThroughput: 4 * 1024 * 1024,
})
putUrls.length = 0
const input2 = await page.$('input[type=file]')
await input2.uploadFile('/tmp/e2e-40mb.bin')
await sleep(500)
const fpEntry = await page.evaluate(() => {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k.startsWith('up:e2e-40mb.bin')) return { k, v: localStorage.getItem(k) }
  }
  return null
})
check('fingerprint saved during upload', !!fpEntry)
// wait until the server has at least one (but not all) chunks, then interrupt
let partial = { received: [] }
for (let i = 0; i < 60 && partial.received.length < 1; i++) {
  await sleep(250)
  partial = await fetch(`${BASE}/api/uploads/${fpEntry.v}`, { headers: auth }).then((r) => r.json())
}
await page.reload({ waitUntil: 'networkidle0' }) // kill in-flight XHRs
await page.waitForSelector('textarea')
await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
})

const st = await fetch(`${BASE}/api/uploads/${fpEntry.v}`, { headers: auth }).then((r) => r.json())
check('server kept partial chunks', !st.completed && st.received.length >= 1 && st.received.length < 5,
  JSON.stringify(st))

putUrls.length = 0
const reqCounter = []
page.on('request', (r) => r.method() === 'PUT' && reqCounter.push(r.url()))
const input3 = await page.$('input[type=file]')
await input3.uploadFile('/tmp/e2e-40mb.bin')
let done2 = false
for (let i = 0; i < 80 && !done2; i++) {
  await sleep(500)
  done2 = await page.evaluate(() =>
    [...document.querySelectorAll('a[download]')].some((a) => a.innerText.includes('e2e-40mb.bin')),
  )
}
check('resumed upload completes', done2)
check('resume skipped already-received chunks', reqCounter.length === 5 - st.received.length,
  `puts=${reqCounter.length}, had=${st.received.length}`)
const fpAfter = await page.evaluate(
  (k) => localStorage.getItem(k), fpEntry.k)
check('fingerprint cleared after complete', fpAfter === null)

// --- 3. paste intake routes to the same pipeline ---
const pasteName = `pasted-${Date.now()}.png`
await page.evaluate((name) => {
  const dt = new DataTransfer()
  dt.items.add(new File([new Uint8Array(64 * 1024)], name, { type: 'image/png' }))
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  document.querySelector('textarea').dispatchEvent(ev)
}, pasteName)
await sleep(1500)
const pasted = await fetch(`${BASE}/api/messages?q=${pasteName}&limit=5`, { headers: auth }).then((r) => r.json())
check('paste -> upload pipeline -> message', pasted.messages.length === 1)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
