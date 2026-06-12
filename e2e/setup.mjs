// 首次运行网页设置令牌的端到端验证。
// 注意：与其他套件不同，需要一个【未设置 TOKEN】的实例：
//   DATA_DIR=$(mktemp -d) PORT=18080 lanshare
import puppeteer from 'puppeteer-core'
const BASE = 'http://localhost:18080'
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
await page.goto(BASE, { waitUntil: 'networkidle0' })

// 1. setup form shows (two password fields = token + confirm)
await sleep(500)
const pwCount = await page.evaluate(() => document.querySelectorAll('input[type=password]').length)
check('setup form with confirm field', pwCount === 2, `pw inputs=${pwCount}`)
const hint = await page.evaluate(() => document.body.innerText.includes('首次使用'))
check('first-run hint shown', hint)
await page.screenshot({ path: '/tmp/shot-setup.png' })

// 2. mismatched confirm -> error
const [tokenInput, confirmInput] = await page.$$('input[type=password]')
await tokenInput.type('hunter2-token')
await confirmInput.type('different')
const btnDisabled = await page.evaluate(() => document.querySelector('button[type=submit]').disabled)
check('button disabled while confirm mismatched', btnDisabled)

// 3. fix confirm, submit -> main UI
await confirmInput.click()
await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control')
await confirmInput.type('hunter2-token')
await page.click('button[type=submit]')
await page.waitForSelector('textarea', { timeout: 5000 }).catch(() => {})
const inApp = await page.evaluate(() => !!document.querySelector('textarea'))
check('setup completes into main UI', inApp)

// 4. second browser (fresh profile) -> normal login, not setup
const page2 = await (await browser.createBrowserContext()).newPage()
await page2.goto(BASE, { waitUntil: 'networkidle0' })
await sleep(500)
const pw2 = await page2.evaluate(() => ({
  count: document.querySelectorAll('input[type=password]').length,
  setupText: document.body.innerText.includes('首次使用'),
}))
check('second visitor sees normal login', pw2.count === 1 && !pw2.setupText, JSON.stringify(pw2))

// 5. wrong token rejected, right token accepted
const tok2 = await page2.$('input[type=password]')
await tok2.type('wrong-token')
await page2.click('button[type=submit]')
await sleep(800)
const errShown = await page2.evaluate(() => document.body.innerText.includes('不正确'))
check('wrong token rejected with message', errShown)
await tok2.click()
await page2.keyboard.down('Control'); await page2.keyboard.press('a'); await page2.keyboard.up('Control')
await tok2.type('hunter2-token')
await page2.click('button[type=submit]')
await page2.waitForSelector('textarea', { timeout: 5000 }).catch(() => {})
check('correct token logs in', await page2.evaluate(() => !!document.querySelector('textarea')))

console.log(failures ? `${failures} FAILURES` : 'ALL PASS')
await browser.close()
process.exit(failures ? 1 : 0)
