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
  executablePath: '/usr/bin/chromium', headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
await page.goto(BASE)
await page.evaluate(async (token) => {
  localStorage.setItem('token', token)
  const r = await fetch('/api/devices', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: '搜索验证机' }) }).then(r => r.json())
  localStorage.setItem('device_id', r.device_id)
  localStorage.setItem('device_name', r.name)
}, TOKEN)
await page.reload({ waitUntil: 'networkidle0' })
await page.waitForSelector('textarea')

const box = await page.$('aside input[placeholder*="搜索"]')
await box.type('历史消息')
await sleep(1000)

// toolbar shows backend total
const toolbar = await page.evaluate(() => document.body.innerText)
check('result count from backend total', /共\s*5[,，]?000\s*条结果/.test(toolbar.replace(/\n/g, ' ')), toolbar.match(/共.{0,12}条结果/)?.[0])

// CSS Custom Highlight API populated
const hl = await page.evaluate(() => ({
  api: 'highlights' in CSS,
  match: CSS.highlights.has('search-match') && CSS.highlights.get('search-match').size > 0,
}))
check('CSS.highlights supported in chromium', hl.api)
check('matches highlighted', hl.match, JSON.stringify(hl))

// Enter walks to first result
await box.press('Enter')
await sleep(400)
let state = await page.evaluate(() => ({
  pos: document.body.innerText.match(/第\s*(\d+)\s*条/)?.[1],
  active: !!document.querySelector('[data-active-result]'),
  activeHl: CSS.highlights.has('search-active') && CSS.highlights.get('search-active').size > 0,
}))
check('Enter -> 第 1 条', state.pos === '1', JSON.stringify(state))
check('active row marked', state.active)
check('active matches in accent highlight', state.activeHl)

await box.press('Enter')
await box.press('Enter')
await sleep(400)
state = await page.evaluate(() => document.body.innerText.match(/第\s*(\d+)\s*条/)?.[1])
check('Enter x2 -> 第 3 条', state === '3', state)

await page.keyboard.down('Shift'); await box.press('Enter'); await page.keyboard.up('Shift')
await sleep(400)
state = await page.evaluate(() => document.body.innerText.match(/第\s*(\d+)\s*条/)?.[1])
check('Shift+Enter -> 第 2 条', state === '2', state)

// down arrow button in toolbar
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.title === '下一条（较旧）')?.click())
await sleep(400)
state = await page.evaluate(() => document.body.innerText.match(/第\s*(\d+)\s*条/)?.[1])
check('toolbar ↓ -> 第 3 条', state === '3', state)

await page.screenshot({ path: '/tmp/shot-search.png' })

// walking past loaded page triggers loadOlder (50 per page): jump 55 times
for (let i = 0; i < 55; i++) { await box.press('Enter'); await sleep(60) }
await sleep(800)
state = await page.evaluate(() => document.body.innerText.match(/第\s*(\d+)\s*条/)?.[1])
check('walk across page boundary (>50)', Number(state) > 50, state)

console.log(failures ? `${failures} FAILURES` : 'ALL PASS')
await browser.close()
process.exit(failures ? 1 : 0)
