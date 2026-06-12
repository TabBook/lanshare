// Verify the drawer slide/fade animation actually plays.
import puppeteer from 'puppeteer-core'
const BASE = 'http://localhost:10088', TOKEN = 'lanshare'
let failures = 0
const check = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); c || failures++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
await page.goto(BASE)
await page.evaluate(async (token) => {
  localStorage.setItem('token', token)
  const r = await fetch('/api/devices', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: '动画测试' }) }).then(r => r.json())
  localStorage.setItem('device_id', r.device_id)
  localStorage.setItem('device_name', r.name)
}, TOKEN)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('textarea')

// open drawer; sample panel transform mid-animation
await page.evaluate(() => [...document.querySelectorAll('header button')].find(b => b.title === '菜单')?.click())
await sleep(60)
const mid = await page.evaluate(() => {
  const panel = document.querySelector('.fixed.z-40 .transition-transform')
  return panel ? getComputedStyle(panel).translate || getComputedStyle(panel).transform : null
})
await sleep(400)
const end = await page.evaluate(() => {
  const panel = document.querySelector('.fixed.z-40 .transition-transform')
  return panel ? getComputedStyle(panel).translate || getComputedStyle(panel).transform : null
})
check('panel animates (mid-flight transform differs)', !!mid && mid !== end, `mid=${mid} end=${end}`)
check('panel lands at translate-x-0', end === '0px' || end === 'none' || end?.includes('matrix(1, 0, 0, 1, 0'), end)

// filter click closes the drawer (with exit animation)
await page.evaluate(() => {
  const drawer = document.querySelector('.fixed.z-40')
  ;[...drawer.querySelectorAll('button')].find(b => b.textContent === '仅文本')?.click()
})
await sleep(80)
const closing = await page.evaluate(() => !!document.querySelector('.fixed.z-40'))
await sleep(400)
const gone = await page.evaluate(() => !document.querySelector('.fixed.z-40'))
check('filter click starts exit animation then unmounts', closing && gone, `closing=${closing} gone=${gone}`)

await browser.close()
console.log(failures ? `${failures} FAILURES` : 'ALL PASS')
process.exit(failures ? 1 : 0)
