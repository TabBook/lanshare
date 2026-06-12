// Phase-3 smoke test: onboarding, timeline render, text send (markdown),
// WS live append, virtual scrolling over 5000 messages, upward pagination.
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:18080'
const TOKEN = 't0ken'
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

let failures = 0
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`)
  if (!cond) failures++
}

// --- seed 5000 messages directly via API ---
async function seed() {
  const r = await fetch(`${BASE}/api/stats`, { headers: auth }).then((r) => r.json())
  if (r.message_count >= 5000) return console.log(`(seed: already ${r.message_count} messages)`)
  console.log('(seeding 5000 messages…)')
  for (let batch = 0; batch < 50; batch++) {
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        fetch(`${BASE}/api/messages`, {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ type: 'text', content: `历史消息 #${batch * 100 + i} —— 测试虚拟滚动` }),
        }),
      ),
    )
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await seed()

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()))

// 1. onboarding
await page.goto(BASE, { waitUntil: 'networkidle0' })
check('onboarding form shows', !!(await page.$('input[type=password]')))
await page.type('input[type=password]', TOKEN)
const nameInput = (await page.$$('input'))[1]
await nameInput.click({ clickCount: 3 })
await nameInput.type('E2E浏览器')
await page.click('button[type=submit]')
await page.waitForSelector('textarea', { timeout: 8000 })
check('main UI after onboarding', true)
await sleep(800)

// 2. timeline rendered & virtualized
const itemCount = await page.evaluate(() => document.querySelectorAll('[data-index]').length)
check('virtualization keeps DOM small', itemCount > 0 && itemCount < 120, `rendered=${itemCount}`)

// 3. initial view is at the bottom (newest visible)
const atBottom = await page.evaluate(() => {
  const el = document.querySelector('main .overflow-y-auto')
  return el.scrollHeight - el.scrollTop - el.clientHeight < 150
})
check('initial scroll pinned to bottom', atBottom)

// 4. send markdown text
await page.type('textarea', '# E2E 标题\n带 **加粗** 和代码：`x=1`')
await page.keyboard.press('Enter')
await sleep(700)
const hasH1 = await page.evaluate(() =>
  [...document.querySelectorAll('.md h1')].some((h) => h.textContent === 'E2E 标题'),
)
check('markdown message rendered (lazy chunk loaded)', hasH1)

// 5. WS live append from "another device"
const wsMsg = `WS推送测试 ${Date.now()}`
await fetch(`${BASE}/api/messages`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ type: 'text', content: wsMsg }),
})
await sleep(900)
const wsShown = await page.evaluate(
  (t) => document.body.innerText.includes(t),
  wsMsg,
)
check('WS new_message appended live', wsShown)

// 6. scroll up -> older pages load, position不跳
const before = await page.evaluate(() => {
  const el = document.querySelector('main .overflow-y-auto')
  el.scrollTop = 0
  return el.scrollHeight
})
await sleep(1200)
const after = await page.evaluate(() => {
  const el = document.querySelector('main .overflow-y-auto')
  return { h: el.scrollHeight, top: el.scrollTop }
})
check('upward pagination grows content', after.h > before, `${before} -> ${after.h}`)
check('scrollTop corrected after prepend', after.top > 100, `top=${after.top}`)

// 7. scroll perf sample over the big list
const fps = await page.evaluate(async () => {
  const el = document.querySelector('main .overflow-y-auto')
  let frames = 0
  const t0 = performance.now()
  const tick = () => {
    frames++
    if (performance.now() - t0 < 1000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  for (let i = 0; i < 25; i++) {
    el.scrollTop -= 300
    await new Promise((r) => setTimeout(r, 40))
  }
  return frames
})
check('smooth scrolling (frames in 1s while scrolling)', fps > 40, `frames=${fps}`)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
