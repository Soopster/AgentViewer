// Real-app browser check of the Web plugin migrations, against a running app.
// Start one with a fixture mod first, e.g.
//   AGENT_VIEWER_PLUGINS_DIR=<dir with an e2e-mod> AGENT_VIEWER_PLUGIN_SETTINGS=<tmp file> npx next dev -p 3917
// (the mod: a 'light' widget saying "mod widget is live", a 'hello' command
// noticing "hello from the e2e mod", and a toolCard for Bash calls). Use
// `localhost`, not 127.0.0.1: next dev withholds its client assets from an
// origin it does not allow, and the page never hydrates.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
const base = process.env.E2E_URL ?? 'http://localhost:3917'
const shots = process.env.E2E_SHOTS
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: true, executablePath: existsSync(chrome) ? chrome : undefined })
const results = []
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-sidebar], aside, nav', { timeout: 90000 })
  await page.waitForTimeout(4000)
  const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }) }
  const palette = async (query) => {
    await page.keyboard.press('Meta+k')
    const input = page.getByPlaceholder(/Search messages, sessions/)
    await input.waitFor()
    await input.fill(query)
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
  }
  const check = async (name, run) => {
    try { await run(); results.push(`PASS ${name}`) } catch (error) { results.push(`FAIL ${name}: ${error.message.split('\n')[0]}`); await shot(`fail-${name.replace(/\W+/g, '-')}`) }
  }

  await check('mod widget in the corner slot', async () => {
    await page.getByText('mod widget is live').waitFor()
    await shot('widget')
  })
  await check('daily summary plugin', async () => {
    await palette('Daily summary of agent work')
    await page.locator('[data-plugin-view="daily-summary"]').waitFor()
    await page.getByRole('button', { name: 'Yesterday' }).click()
    await page.waitForTimeout(500)
    await shot('daily-summary')
    await page.keyboard.press('Escape')
    await page.locator('[data-plugin-view="daily-summary"]').waitFor({ state: 'detached' })
  })
  await check('bookmarks plugin', async () => {
    await palette('Browse all bookmarks')
    await page.getByText(/bookmark/i).first().waitFor()
    await shot('bookmarks')
    await page.keyboard.press('Escape')
  })
  await check('provenance plugin', async () => {
    await palette('Code provenance')
    await page.getByText(/provenance|blame/i).first().waitFor()
    await shot('provenance')
    await page.keyboard.press('Escape')
  })
  await check('remote access plugin', async () => {
    await palette('Remote access')
    await page.getByText(/pair|remote/i).first().waitFor()
    await shot('remote-access')
    await page.keyboard.press('Escape')
  })
  await check('run dashboard tab (plugin dashboard)', async () => {
    await page.getByRole('button', { name: 'Open run dashboard' }).first().click()
    await page.getByRole('tab', { name: /Runs/ }).waitFor()
    await page.getByRole('tab', { name: /Agent Operations/ }).click()
    await page.waitForTimeout(1000)
    await shot('dashboards')
  })
  await check('mod command from the palette', async () => {
    await palette('E2E mod says hello')
    await page.getByText('hello from the e2e mod').waitFor()
  })
  await check('plugin manager lists the mod', async () => {
    await palette('Plugins')
    await page.locator('[data-plugin-row="e2e-mod"]').waitFor()
    await page.locator('[data-plugin-row="daily-summary"]').waitFor()
    await shot('plugin-manager')
    await page.keyboard.press('Escape')
  })
  await check('handoff plugin on a session', async () => {
    const row = page.locator('[data-session-row], [data-session-key]').first()
    if (await row.count()) await row.click()
    await page.waitForTimeout(2500)
    await palette('Handoff brief')
    await page.locator('[data-plugin-view="handoff"]').waitFor()
    await shot('handoff')
    await page.keyboard.press('Escape')
  })
  await check('mod tool card in a transcript', async () => {
    const card = page.locator('[data-plugin-tool-card="e2e-mod"]').first()
    await card.waitFor({ timeout: 8000 })
    await card.scrollIntoViewIfNeeded()
    await shot('tool-card')
  })
  results.push(errors.length ? `PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}` : 'no page errors')
} finally {
  await browser.close()
  console.log(results.join('\n'))
}
