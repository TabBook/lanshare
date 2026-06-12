// Phase-5: sidebar — debounced search + jump-to-context with anchor
// highlight, type filters, image grid with month groups, date jump,
// storage bar, device rename, theme toggle, mobile drawer.
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

// unique searchable message
const needle = `独特搜索词${Date.now()}`
await fetch(`${BASE}/api/messages`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ type: 'text', content: `前后文 A ${needle} 前后文 B` }),
})

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
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: '侧栏测试机' }),
  }).then((r) => r.json())
  localStorage.setItem('device_id', r.device_id)
  localStorage.setItem('device_name', r.name)
}, TOKEN)
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('textarea')

// --- 1. search with debounce ---
const searchBox = await page.$('aside input[placeholder*="搜索"]')
const reqs = []
page.on('request', (r) => r.url().includes('q=') && reqs.push(r.url()))
await searchBox.type(needle, { delay: 30 }) // typing fast: debounce should coalesce
await sleep(900)
check('debounce coalesced requests', reqs.length <= 2, `requests=${reqs.length}`)
const found = await page.evaluate((n) => document.body.innerText.includes(n), needle)
check('search results shown', found)

// --- 2. jump back to context ---
const jumpBtn = await page.evaluateHandle(() =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === '跳回上下文'),
)
check('jump button exists in results', !!jumpBtn.asElement())
await jumpBtn.asElement().click()
await sleep(900)
const highlighted = await page.evaluate(() => !!document.querySelector('.anchor-flash'))
check('anchored message highlighted', highlighted)
const headerHasBack = await page.evaluate(() => document.body.innerText.includes('回到最新'))
check('back-to-latest control visible', headerHasBack)

// jump to an OLD message (mid-seed), then scrolling down must load newer pages
await searchBox.click({ clickCount: 3 })
await searchBox.type('#2500', { delay: 20 })
await sleep(700)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent === '跳回上下文')?.click()
})
await sleep(900)
const newerLoads = await page.evaluate(async () => {
  const el = document.querySelector('main .overflow-y-auto')
  const h0 = el.scrollHeight
  el.scrollTop = el.scrollHeight
  await new Promise((r) => setTimeout(r, 1200))
  return el.scrollHeight > h0
})
check('anchor mode loads newer downward', newerLoads)

// --- 3. filters ---
const clickFilter = async (label) => {
  await page.evaluate((l) => {
    ;[...document.querySelectorAll('aside button')].find((b) => b.textContent === l)?.click()
  }, label)
  await sleep(800)
}
await clickFilter('仅文本')
const onlyTextOk = await page.evaluate(() => {
  const links = document.querySelectorAll('main a[download]')
  return links.length === 0
})
check('text filter hides files', onlyTextOk)

await clickFilter('仅文件')
const onlyFiles = await page.evaluate(() =>
  document.querySelectorAll('main a[download]').length > 0 &&
  document.querySelectorAll('main .md').length === 0,
)
check('file filter shows only files', onlyFiles)

await clickFilter('仅图片')
const gridInfo = await page.evaluate(() => ({
  months: [...document.querySelectorAll('main .font-semibold')].map((h) => h.textContent),
  thumbs: document.querySelectorAll('main img, main button .rounded-full').length,
}))
check('image grid with month group', gridInfo.months.some((m) => /\d+年\d+月/.test(m)),
  JSON.stringify(gridInfo.months))
check('grid has thumbnails', gridInfo.thumbs > 0)

await clickFilter('全部')

// --- 4. date jump ---
const today = new Date().toISOString().slice(0, 10)
await page.evaluate((d) => {
  const inp = document.querySelector('aside input[type=date]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(inp, d)
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
}, today)
await page.evaluate(() => {
  ;[...document.querySelectorAll('aside button')].find((b) => b.textContent === '跳转')?.click()
})
await sleep(900)
const dateJumped = await page.evaluate(() => document.body.innerText.includes('历史定位'))
check('date jump enters anchor mode', dateJumped)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent === '回到最新')?.click()
})
await sleep(600)

// --- 5. storage bar & message count ---
const sidebarText = await page.evaluate(() => document.querySelector('aside').innerText)
check('storage usage shown', /存储用量/.test(sidebarText) && /GB|MB|KB|B/.test(sidebarText))
check('message count shown', /共 \d+ 条消息/.test(sidebarText))

// --- 6. device rename ---
await page.evaluate(() => {
  const row = [...document.querySelectorAll('aside .group')].find((r) => r.innerText.includes('本机'))
  row.querySelector('button')?.click() // 改名
})
await sleep(200)
await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
await page.keyboard.type('改名后的设备')
await page.keyboard.press('Enter')
await sleep(700)
const renamed = await fetch(`${BASE}/api/devices`, { headers: auth }).then((r) => r.json())
check('device renamed via sidebar', renamed.some((d) => d.name === '改名后的设备'))

// --- 7. theme toggle ---
const wasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
await page.evaluate(() => {
  ;[...document.querySelectorAll('aside button')].find((b) => /色模式/.test(b.textContent))?.click()
})
const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
check('theme toggles', wasDark !== isDark)

// --- 8. mobile drawer ---
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
await sleep(400)
const sidebarHidden = await page.evaluate(() => {
  const aside = document.querySelector('aside')
  return getComputedStyle(aside).display === 'none'
})
check('sidebar hidden on mobile', sidebarHidden)
await page.evaluate(() => {
  ;[...document.querySelectorAll('header button')].find((b) => b.title === '菜单')?.click()
})
await sleep(400)
const drawerShown = await page.evaluate(() => {
  const fixed = document.querySelector('.fixed.inset-0.z-40')
  return !!fixed && fixed.innerText.includes('LanShare')
})
check('hamburger opens drawer', drawerShown)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
