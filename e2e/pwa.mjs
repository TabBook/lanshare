// Phase-7: PWA — service worker registration, manifest, offline app shell,
// warm-load served from SW cache, cold-start interactivity timing.
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:18080'
const TOKEN = 't0ken'

let failures = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

// cold start timing: navigation -> app interactive (form or textarea visible)
const t0 = Date.now()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => document.querySelector('textarea') || document.querySelector('input[type=password]'),
)
const coldMs = Date.now() - t0
check('cold start interactive < 1s', coldMs < 1000, `${coldMs}ms`)

// login
await page.evaluate(async (token) => {
  localStorage.setItem('token', token)
  const r = await fetch('/api/devices', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'PWA测试机' }),
  }).then((r) => r.json())
  localStorage.setItem('device_id', r.device_id)
  localStorage.setItem('device_name', r.name)
}, TOKEN)
await page.reload({ waitUntil: 'domcontentloaded' })

// manifest reachable & valid
const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]')?.href
  if (!href) return null
  return fetch(href).then((r) => r.json())
})
check('manifest valid with icons', !!manifest && manifest.icons?.length >= 2 && manifest.display === 'standalone')

// SW registered & activated
await sleep(1500)
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  return reg?.active?.state || 'none'
})
check('service worker active', swState === 'activated', swState)

// warm reload: static assets must come from SW cache
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(500)
const cacheStats = await page.evaluate(() => {
  const entries = performance.getEntriesByType('resource')
  const assets = entries.filter((e) => e.name.includes('/assets/'))
  return {
    total: assets.length,
    fromSW: assets.filter((e) => e.deliveryType === 'cache' || e.transferSize === 0).length,
  }
})
check('warm load serves assets from cache', cacheStats.total > 0 && cacheStats.fromSW === cacheStats.total,
  JSON.stringify(cacheStats))

// offline: app shell still opens (API calls fail, shell renders)
await page.setOfflineMode(true)
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
await sleep(1000)
const offlineShell = await page.evaluate(() => !!document.getElementById('root')?.children.length)
check('offline reload serves app shell from SW', offlineShell)
await page.setOfflineMode(false)

// API responses must never be cached by SW
const apiFresh = await page.evaluate(async () => {
  const keys = await caches.keys()
  for (const k of keys) {
    const reqs = await (await caches.open(k)).keys()
    if (reqs.some((r) => new URL(r.url).pathname.startsWith('/api/'))) return false
  }
  return true
})
check('SW caches contain no /api/ responses', apiFresh)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
