// UI regression check. Needs `npm run dev` running in another terminal.
//   npm run verify
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// ?backend=mock keeps these geometry tests off the real database.
const URL = 'http://localhost:5173/?backend=mock'
const OUT = process.argv[2] ?? 'tools/screenshots'
const VW = 1280, VH = 800

const fails = []
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) fails.push(msg) }

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: VW, height: VH } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.addInitScript(() => { try { localStorage.clear() } catch {} })
await page.goto(URL, { waitUntil: 'networkidle' })

// The mock backend starts empty, so the test makes its own fixture: two
// friends, with an unread message on the one that is not on screen.
await page.waitForTimeout(200)
await page.evaluate(async () => {
  const b = window.backend
  await b.addFriend('AAAA-2222')
  await b.addFriend('BBBB-3333')
  const fs = await b.friends()
  b._receive(fs[1].id, 'unread message for the badge')
})
await page.waitForTimeout(200)

const box = async (sel) => page.locator(sel).boundingBox()
const settle = () => page.waitForTimeout(500)

// ---- collapsed ----
await settle()
const tab0 = await box('.tab')
console.log('tab (collapsed):', JSON.stringify(tab0))

ok(!!tab0, 'tab has a box')
ok(tab0.x >= 0 && tab0.x + tab0.width <= VW + 1, `tab is horizontally on screen (x=${tab0?.x}, right=${tab0 ? tab0.x + tab0.width : '?'}, vw=${VW})`)
ok(tab0.y >= 0 && tab0.y + tab0.height <= VH + 1, 'tab is vertically on screen')
ok(Math.abs(tab0.x + tab0.width - VW) < 2, 'tab is flush against the right screen edge')
ok(await page.locator('.tab').isVisible(), 'tab is visible')

// hold for several frames — the original bug only appeared after JS ran
await page.waitForTimeout(1200)
const tabHeld = await box('.tab')
ok(Math.abs(tabHeld.x - tab0.x) < 1 && Math.abs(tabHeld.y - tab0.y) < 1, 'tab stays put after JS settles (does not fly off screen)')

const panel0 = await box('.panel')
ok(panel0.x >= VW - 2, `panel is parked off screen while collapsed (x=${panel0.x})`)

await page.screenshot({ path: `${OUT}/dock-collapsed.png` })

// ---- expand ----
await page.locator('.tab').click()
await settle()
const tab1 = await box('.tab')
const panel1 = await box('.panel')
console.log('tab (expanded):  ', JSON.stringify(tab1))
console.log('panel (expanded):', JSON.stringify(panel1))

ok(Math.abs(tab1.x - tab0.x) < 1, 'tab does not move horizontally when opening')
ok(panel1.x >= 0 && panel1.x + panel1.width <= VW + 1, 'panel is fully on screen when open')
ok(panel1.y >= 0 && panel1.y + panel1.height <= VH + 1, 'panel is fully on screen vertically')
ok(Math.abs(panel1.x + panel1.width - tab1.x) < 2, 'panel sits flush against the inner side of the tab')
ok(await page.locator('.friendbar').isVisible(), 'friend bar is visible')
ok(await page.locator('.stylebtn').isVisible(), 'style button is visible')
ok(await page.locator('.msg-input').isVisible(), 'message box is visible')

// The panel is a sprite: its box must be a whole multiple of the native size.
const U = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')))
ok(Number.isInteger(U * 1), `--u is a whole number of css px (${U})`)
ok(Math.abs(panel1.width - 85 * U) < 1, `panel width is 85 native px x ${U} (${panel1.width})`)
ok(Math.abs(panel1.height - 127 * U) < 1, `panel height is 127 native px x ${U} (${panel1.height})`)

// Furniture must land exactly where the art expects it.
for (const [sel, nx, ny, nw, nh] of [
  ['.friendbar', 11, 9, 45, 10],
  ['.stylebtn', 65, 9, 9, 10],
  ['.log', 8, 24, 69, 76],
  ['.msg-input', 9, 109, 57, 8],
  ['.send', 68, 106, 9, 11],
]) {
  const b = await box(sel)
  const dx = Math.abs(b.x - (panel1.x + nx * U))
  const dy = Math.abs(b.y - (panel1.y + ny * U))
  const dw = Math.abs(b.width - nw * U)
  const dh = Math.abs(b.height - nh * U)
  ok(dx < 1 && dy < 1 && dw < 1 && dh < 1,
     `${sel} sits at native ${nx},${ny} ${nw}x${nh} (off by ${dx.toFixed(1)},${dy.toFixed(1)} size ${dw.toFixed(1)},${dh.toFixed(1)})`)
}

// Style switcher opens its own menu, separate from the friend list.
await page.locator('.stylebtn').click()
await settle()
ok(await page.locator('.styles-drop').isVisible(), 'style button opens the styles menu')
ok(await page.locator('.friends-drop').isHidden(), 'styles menu does not open the friend list')
const styleCount = await page.locator('.style-opt').count()
ok(styleCount >= 2, `styles menu lists themes (${styleCount})`)
await page.screenshot({ path: `${OUT}/dock-styles.png` })

// Switching style must actually repaint the sprites.
const before = await page.locator('.panel').evaluate((el) => getComputedStyle(el).backgroundImage)
const t0 = Date.now()
await page.locator('.style-opt:not(.active)').first().click()
await page.waitForFunction(
  (was) => getComputedStyle(document.querySelector('.panel')).backgroundImage !== was,
  before,
  { timeout: 5000 }
).catch(() => {})
const switchMs = Date.now() - t0
const after = await page.locator('.panel').evaluate((el) => getComputedStyle(el).backgroundImage)
ok(before !== after, `picking a style recolours the panel sprite (${switchMs}ms)`)
ok(switchMs < 600, `style switch is prompt (${switchMs}ms)`)
await page.screenshot({ path: `${OUT}/dock-restyled.png` })

// Back to the default, and the friend list still works.
await page.locator('.style-opt').first().click()
await page.waitForTimeout(300)
await page.locator('.friendbar').click()
await settle()
ok(await page.locator('.friends-drop').isVisible(), 'friend bar opens the friend list')
ok(await page.locator('.styles-drop').isHidden(), 'friend list does not open the styles menu')
await page.screenshot({ path: `${OUT}/dock-friends.png` })
await page.locator('.friendbar').click()   // close the menu, leave the panel open
await settle()

await page.screenshot({ path: `${OUT}/dock-expanded.png` })

// ---- unread bubble ----
// The mock seeds an unread conversation, so the bubble should be up.
ok(await page.locator('.tab-badge').isVisible(), 'unread bubble shows when there are unread messages')
ok(await page.locator('.badge-frame.a').count() === 1 && await page.locator('.badge-frame.b').count() === 1,
   'unread bubble has both drawn frames')
const blink = await page.locator('.badge-frame.b').evaluate((el) => getComputedStyle(el).animationName)
ok(blink === 'badge-flicker', `unread bubble alternates its two reds (${blink})`)
const badgeBox = await box('.tab-badge')
ok(Math.abs(badgeBox.width - 6 * U) < 1 && Math.abs(badgeBox.height - 6 * U) < 1,
   `unread bubble is 6 native px square (${badgeBox.width}x${badgeBox.height})`)

// ---- pixel art must not be smoothed ----
const rendering = await page.locator('.tab-frame.rest').evaluate((el) => getComputedStyle(el).imageRendering)
ok(rendering === 'pixelated', `sprite renders pixelated (got "${rendering}")`)

const frameShown = await page.locator('.tab-frame.open').evaluate((el) => getComputedStyle(el).visibility)
ok(frameShown === 'visible', 'open frame is the one showing while expanded')

// ---- scrolling still works with the scrollbar hidden ----
const scroll = await page.locator('.log').evaluate((el) => {
  const bar = el.offsetWidth - el.clientWidth
  el.scrollTop = 9999
  return { bar, canScroll: el.scrollHeight > el.clientHeight, top: el.scrollTop }
})
ok(scroll.bar === 0, `log shows no scrollbar gutter (${scroll.bar}px)`)
ok(!scroll.canScroll || scroll.top > 0, 'log still scrolls programmatically')

// ---- collapse again ----
await page.locator('.tab').click()
await settle()
const tab2 = await box('.tab')
ok(Math.abs(tab2.x - tab0.x) < 1 && Math.abs(tab2.y - tab0.y) < 1, 'tab returns to exactly where it started')

// ---- drag to the left edge ----
await page.mouse.move(tab0.x + tab0.width / 2, tab0.y + tab0.height / 2)
await page.mouse.down()
await page.mouse.move(200, 300, { steps: 12 })
await page.mouse.up()
await settle()
const tab3 = await box('.tab')
console.log('tab (left edge): ', JSON.stringify(tab3))
ok(Math.abs(tab3.x) < 2, `tab snapped flush to the left screen edge (x=${tab3.x})`)
await page.screenshot({ path: `${OUT}/dock-left-edge.png` })

await page.locator('.tab').click()
await settle()
const panel3 = await box('.panel')
ok(panel3.x >= 0 && panel3.x + panel3.width <= VW + 1, 'panel opens on screen from the left edge too')
ok(Math.abs(panel3.x - (tab3.x + tab3.width)) < 2, 'panel sits on the inner side of the left-docked tab')
await page.screenshot({ path: `${OUT}/dock-left-expanded.png` })

ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)

await browser.close()
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall checks passed')
process.exit(fails.length ? 1 : 0)
