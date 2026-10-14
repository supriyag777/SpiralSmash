// End-to-end smoke test for the built Three.js game. Exercises desktop inputs, a real simulated
// hazard/result transition, the device-local board/share card, localization and landscape touch.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
const errors = []
const guard = setTimeout(() => fail('timed out'), 120_000)

function cleanup() {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}
async function fail(message) {
  console.error(`smoke: FAIL — ${message}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}
async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('preview server did not start')
}
async function openGame(context, suffix) {
  const page = await context.newPage()
  page.on('console', message => message.type() === 'error' && errors.push(message.text()))
  page.on('pageerror', error => errors.push(String(error)))
  page.on('response', response => response.status() >= 400 && errors.push(`HTTP ${response.status()} ${response.url()}`))
  await page.goto(url)
  await page.waitForSelector('[data-screen="title"].is-active', { timeout: 30_000 })
  await page.waitForFunction(() => window.__spiral?.game && window.__spiral?.ui?.screen === 'title')
  await page.evaluate(() => document.fonts.ready)
  const identity = await page.evaluate(() => ({
    title: document.title,
    family: getComputedStyle(document.querySelector('.logo-main')).fontFamily,
    bodyFamily: getComputedStyle(document.querySelector('.tagline')).fontFamily,
    lang: document.documentElement.lang,
  }))
  if (!identity.title.includes('Spiral Smash')) throw new Error(`wrong title: ${identity.title}`)
  if (!identity.family.includes('Sora') || !identity.bodyFamily.includes('Figtree')) throw new Error(`wrong font pairing: ${JSON.stringify(identity)}`)
  await page.screenshot({ path: `${out}/${suffix}-title.png` })
  return page
}

try {
  await waitForServer()
  const args = ['--ignore-gpu-blocklist', '--use-gl=swiftshader']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const page = await openGame(desktop, '01-desktop-en')
  await page.click('[data-action="daily"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  await page.click('[data-action="pause"]')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.screenshot({ path: `${out}/03-pause.png` })
  await page.click('[data-screen="pause"] [data-action="settings"]')
  await page.waitForSelector('[data-screen="settings"].is-active')
  await page.screenshot({ path: `${out}/04-settings-en.png` })
  await page.click('[data-screen="settings"] [data-action="lang"][data-value="zh-CN"]')
  const chinese = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title }))
  if (chinese.lang !== 'zh-CN' || !chinese.title.includes('Spiral Smash')) throw new Error(`Chinese localization did not activate: ${JSON.stringify(chinese)}`)
  await page.screenshot({ path: `${out}/05-settings-zh.png` })
  await page.click('[data-screen="settings"] [data-action="lang"][data-value="en"]')
  await page.click('[data-screen="settings"] [data-action="closeModal"]')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.click('[data-screen="pause"] [data-action="resume"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  const beforeKey = await page.evaluate(() => window.__spiral.game.sim.phi)
  await page.keyboard.down('KeyA')
  await page.waitForTimeout(180)
  await page.keyboard.up('KeyA')
  await page.waitForTimeout(80)
  const afterKey = await page.evaluate(() => ({ phi: window.__spiral.game.sim.phi, turn: window.__spiral.input.turn }))
  if (afterKey.phi >= beforeKey - 0.15 || afterKey.turn !== 0) throw new Error(`A-key did not rotate/release correctly: ${JSON.stringify({ beforeKey, afterKey })}`)
  // Keep the control assertion separate from progression: aim the ball at the next clear opening
  // so a browser frame-rate difference cannot make this automation accidentally miss the first gap.
  await page.evaluate(() => {
    const sim = window.__spiral.game.sim
    const spec = sim.tower.floors[sim.floor]
    const gaps = spec.slots.filter(slot => slot === 'gap').length
    sim.phi = -((spec.offset + gaps * Math.PI / 16))
    sim.prevPhi = sim.phi
    sim.rotVel = 0
  })
  await page.waitForTimeout(1_100)
  const afterKeyboard = await page.evaluate(() => ({ score: window.__spiral.game.sim.score, floors: window.__spiral.game.sim.floors, phi: window.__spiral.game.sim.phi }))
  if (afterKeyboard.score <= 0 || afterKeyboard.floors <= 0) throw new Error(`first scored drop did not register: ${JSON.stringify(afterKeyboard)}`)

  const beforeDrag = afterKeyboard.phi
  await page.evaluate(() => {
    const canvas = document.querySelector('#game')
    const rect = canvas.getBoundingClientRect()
    const x = rect.left + rect.width * 0.5
    const y = rect.top + rect.height * 0.5
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 91, pointerType: 'mouse', button: 0, clientX: x, clientY: y }))
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 91, pointerType: 'mouse', clientX: x + 135, clientY: y }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 91, pointerType: 'mouse', button: 0, clientX: x + 135, clientY: y }))
  })
  await page.waitForTimeout(120)
  const afterDrag = await page.evaluate(() => window.__spiral.game.sim.phi)
  if (Math.abs(afterDrag - beforeDrag) < 0.5) throw new Error('Mouse drag did not rotate the tower')

  // Simulate the browser's Gamepad API without requiring a physical controller on CI.
  await page.evaluate(() => {
    const pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] })
    window.__smokePad = pad
  })
  const beforePad = await page.evaluate(() => window.__spiral.game.sim.phi)
  await page.evaluate(() => { window.__smokePad.axes[0] = 0.9 })
  await page.waitForTimeout(300)
  await page.evaluate(() => { window.__smokePad.axes[0] = 0 })
  const afterPad = await page.evaluate(() => window.__spiral.game.sim.phi)
  if (afterPad <= beforePad + 0.15) throw new Error('Gamepad left-stick did not rotate the tower')
  await page.screenshot({ path: `${out}/02-gameplay.png` })
  console.log(`smoke: first-drop ${afterKeyboard.score} points / ${afterKeyboard.floors} floor, mouse ${Math.abs(afterDrag - beforeDrag).toFixed(2)} rad, gamepad ${Math.abs(afterPad - beforePad).toFixed(2)} rad`)
  const modeBeforePause = await page.evaluate(() => ({ mode: window.__spiral.game.mode, screen: window.__spiral.ui.screen }))
  if (modeBeforePause.mode === 'ended' || modeBeforePause.screen === 'results') {
    await page.keyboard.press('Space')
    await page.waitForSelector('[data-screen="hud"].is-active')
  }

  // Place the real simulation immediately above a generated danger tile; the normal collision and
  // result events handle the impact, save the score locally and drive the player-visible results.
  await page.evaluate(() => {
    const sim = window.__spiral.game.sim
    const index = sim.tower.floors.findIndex((floor, i) => i >= 3 && floor.slots.includes('danger'))
    if (index < 0) throw new Error('seeded tower has no static hazard to exercise')
    const floor = sim.tower.floors[index]
    const slot = floor.slots.indexOf('danger')
    const angle = floor.offset + (slot + 0.5) * Math.PI * 2 / 16
    const top = -index * 3.3
    sim.floor = index
    sim.y = top + 0.31
    sim.prevY = sim.y
    sim.vy = -1
    sim.phi = -angle
    sim.prevPhi = sim.phi
  })
  await page.waitForSelector('[data-screen="results"].is-active', { timeout: 8_000 })
  await page.waitForTimeout(800)
  const local = await page.evaluate(() => ({ saved: window.__spiral.save.data.leaderboard.length, score: document.querySelector('[data-el="rScore"]').textContent, outcome: document.querySelector('[data-el="rTitle"]').textContent }))
  if (local.saved < 1 || Number(local.score) <= 0) throw new Error(`run result was not saved locally: ${JSON.stringify(local)}`)
  await page.screenshot({ path: `${out}/06-results.png` })
  await page.click('[data-screen="results"] [data-action="board"]')
  await page.waitForSelector('[data-screen="board"].is-active')
  if (!(await page.locator('[data-el="boardList"] li').count())) throw new Error('device-local board did not render its new record')
  await page.screenshot({ path: `${out}/07-local-board.png` })
  await page.click('[data-screen="board"] [data-action="closeModal"]')
  await page.waitForSelector('[data-screen="results"].is-active')
  await page.click('[data-screen="results"] [data-action="share"]')
  await page.waitForSelector('[data-screen="share"].is-active', { timeout: 15_000 })
  await page.locator('[data-el="shareImg"]').waitFor()
  await page.waitForFunction(() => document.querySelector('[data-el="shareImg"]').naturalWidth > 0)
  await page.screenshot({ path: `${out}/08-share-card.png` })
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="results"].is-active')
  await page.keyboard.press('Space')
  await page.waitForSelector('[data-screen="hud"].is-active')
  const restarted = await page.evaluate(() => window.__spiral.game.sim.score)
  if (restarted !== 0) throw new Error(`Space did not instantly restart the run (score=${restarted})`)
  await desktop.close()

  const zhContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' })
  const zhPage = await openGame(zhContext, '09-chinese-title')
  const lang = await zhPage.evaluate(() => document.documentElement.lang)
  if (lang !== 'zh-CN') throw new Error(`browser Simplified Chinese locale did not load (lang=${lang})`)
  await zhContext.close()

  const phoneContext = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' })
  const phone = await openGame(phoneContext, '10-landscape-phone')
  await phone.tap('[data-action="daily"]')
  await phone.waitForSelector('[data-screen="hud"].is-active')
  const phoneBefore = await phone.evaluate(() => window.__spiral.game.sim.phi)
  await phone.locator('[data-touch="-1"]').dispatchEvent('pointerdown', { bubbles: true, pointerId: 101, pointerType: 'touch', button: 0, isPrimary: true })
  await phone.waitForTimeout(350)
  await phone.locator('[data-touch="-1"]').dispatchEvent('pointerup', { bubbles: true, pointerId: 101, pointerType: 'touch', button: 0, isPrimary: true })
  await phone.waitForTimeout(120)
  const phoneAfter = await phone.evaluate(() => ({ phi: window.__spiral.game.sim.phi, overflow: document.documentElement.scrollWidth > innerWidth }))
  if (Math.abs(phoneAfter.phi - phoneBefore) < 0.2) throw new Error('landscape phone touch controls did not rotate the tower')
  if (phoneAfter.overflow) throw new Error('landscape phone layout overflows horizontally')
  await phone.screenshot({ path: `${out}/11-landscape-phone-hud.png` })
  await phoneContext.close()

  if (errors.length) throw new Error(`browser errors:\n  ${errors.join('\n  ')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — keyboard, pointer, gamepad, daily run, hazard results, local score/board/share, restart, English/Chinese and 844×390 touch (${out}/)`)
} catch (error) {
  await fail(error?.message ?? String(error))
}
