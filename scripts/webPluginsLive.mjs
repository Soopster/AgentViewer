// Real-app browser check of the Web plugin migrations, against a running app.
// Start one with a fixture mod first, e.g.
//   AGENT_VIEWER_PLUGINS_DIR=<dir with an e2e-mod> AGENT_VIEWER_PLUGIN_SETTINGS=<tmp file> npx next dev -p 3917
// (the mod: a 'light' widget saying "mod widget is live", a 'hello' command
// noticing "hello from the e2e mod", a toolCard for Bash calls, a 'tally' data
// view, a 'gauge' component view in web.mjs, and an "Echo agent" provider). Use
// `localhost`, not 127.0.0.1: next dev withholds its client assets from an
// origin it does not allow, and the page never hydrates.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
const base = process.env.E2E_URL ?? 'http://localhost:3917'
const shots = process.env.E2E_SHOTS
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Switching provider writes the checkout's shared provider.json; put it back.
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
const providerFile = '.agent-viewer-data/provider.json'
const savedProvider = existsSync(providerFile) ? readFileSync(providerFile, 'utf8') : null
process.on('exit', () => { if (savedProvider === null) rmSync(providerFile, { force: true }); else writeFileSync(providerFile, savedProvider) })
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
    // Each check is capped, so one stuck step reports itself instead of hanging the run.
    let timer
    const cap = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out after 90s')), 90_000) })
    try { await Promise.race([run(), cap]); results.push(`PASS ${name}`) } catch (error) { results.push(`FAIL ${name}: ${error.message.split('\n')[0]}`); await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => {}) } finally { clearTimeout(timer) }
    console.log(results.at(-1))
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
  await check('a repository command with no project says why', async () => {
    await palette('Checkpoints & review')
    await page.getByText('Checkpoints & review needs a project').waitFor()
    assert.equal(await page.locator('[data-plugin-view="checkpoints"]').count(), 0)
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
  await check('checkpoints plugin: turns, a turn\'s changes, working changes', async () => {
    await palette('Checkpoints & review')
    const view = page.locator('[data-plugin-view="checkpoints"]')
    await view.waitFor()
    await view.getByText(/^Turns · \d+/).waitFor()
    const first = view.locator('[data-checkpoint]').first()
    if (await first.count()) {
      await first.click()
      await view.getByText(/Changed since|Nothing has changed/).first().waitFor()
    }
    await view.getByRole('button', { name: /^Working changes/ }).click()
    await view.getByPlaceholder('Commit message').waitFor()
    assert.equal(await view.locator('[role="status"]').filter({ hasText: /error|failed|unknown/i }).count(), 0, 'the view reported an error')
    // A changed file's history opens the file-history plugin in its place.
    await view.getByRole('button', { name: /^Turns/ }).click()
    // The first turn with a changed file still on disk; a silent skip would prove nothing.
    const turns = view.locator('[data-checkpoint]')
    const history = view.locator('[data-checkpoint-history]').first()
    for (let index = 0; index < Math.min(await turns.count(), 15) && !(await history.count()); index++) {
      await turns.nth(index).click()
      await view.getByText(/Changed since|Nothing has changed/).first().waitFor()
      // Wait for this turn's own changes, not the previous turn's still on screen.
      await view.getByText('Reading…', { exact: true }).waitFor({ state: 'detached' })
    }
    assert.ok(await history.count(), 'no turn among the newest 15 has a changed file to open the history of')
    {
      await history.click()
      const fileView = page.locator('[data-plugin-view="file-history"]')
      await fileView.waitFor()
      await fileView.locator('[data-file-history-step], :text("No turn changed this file")').first().waitFor()
      assert.equal(await fileView.locator('[role="status"]').filter({ hasText: /outside|error|failed/i }).count(), 0, 'file history reported an error')
      await shot('file-history')
      await page.keyboard.press('Escape')
      await fileView.waitFor({ state: 'detached' })
      return
    }
    assert.equal(await view.locator('[role="status"]').filter({ hasText: /error|failed|unknown/i }).count(), 0, 'the view reported an error')
    await shot('checkpoints')
    await page.keyboard.press('Escape')
    await view.waitFor({ state: 'detached' })
  })
  await check('session insights: files touched, tool timing, index search', async () => {
    await palette('Files touched by this session')
    const files = page.locator('[data-plugin-view="changed-files"]')
    await files.waitFor()
    await files.getByText(/turns ·|no edits recorded/).first().waitFor()
    await page.keyboard.press('Escape')
    await files.waitFor({ state: 'detached' })
    await palette('Tool timing by turn')
    const timing = page.locator('[data-plugin-view="tool-timing"]')
    await timing.waitFor()
    await timing.locator('[data-timing-turn], :text("No timed tool calls")').first().waitFor()
    await shot('tool-timing')
    await page.keyboard.press('Escape')
    await timing.waitFor({ state: 'detached' })
    await palette('Search the session index')
    const search = page.locator('[data-plugin-view="index-search"]')
    await search.waitFor()
    await search.getByLabel('Search').fill('plugin')
    await search.locator('[data-search-result]').first().waitFor()
    await shot('index-search')
    await search.locator('[data-search-result]').first().click()
    await search.waitFor({ state: 'detached' })
  })
  await check('mod view: draw and run an action', async () => {
    await palette('Mod views')
    await page.locator('[data-plugin-view="mod-views"]').waitFor()
    await page.getByText('Fruit tally').waitFor()
    const before = Number(/count (\d+)/.exec(await page.locator('[data-mod-view-item="apples"]').innerText())[1])
    await page.locator('[data-mod-view-item="apples"]').click()
    await page.getByText(`count ${before + 1}`).waitFor()
    await page.getByText('bumped apples').waitFor()
    await shot('mod-views')
    await page.keyboard.press('Escape')
  })
  await check('mod component: its own React UI, state and server action', async () => {
    await palette('Mod views')
    await page.locator('[data-plugin-view="mod-views"]').waitFor()
    await page.getByRole('button', { name: 'Gauge', exact: true }).click()
    await page.getByText('GAUGE level 3').waitFor()
    await page.getByRole('button', { name: 'raise' }).click()
    await page.getByText('GAUGE level 4').waitFor()
    await page.getByRole('button', { name: 'bump on the server' }).click()
    await page.getByText('bumped apples').first().waitFor()
    await page.waitForTimeout(800)
    assert.ok(await page.getByText('GAUGE level 4').isVisible(), 'running a server action remounted the component and lost its state')
    await shot('mod-component')
    await page.keyboard.press('Escape')
  })
  await check('mod view as its own surface: opened by its own palette command', async () => {
    await palette('Gauge')
    await page.locator('[data-plugin-view="mod-view:e2e-mod:gauge"]').waitFor()
    await page.getByText('GAUGE level').first().waitFor()
    assert.equal(await page.getByRole('button', { name: 'Tally', exact: true }).count(), 0, 'a pinned view shows no tabs for the mod\'s other views')
    await shot('mod-view-surface')
    await page.keyboard.press('Escape')
  })
  await check('provider mod: pick it, start a session, stream a reply', async () => {
    await page.getByLabel('Provider').first().selectOption('mod-e2e-mod')
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: 'Start a new agent session' }).first().click()
    const composer = page.locator('.av-web-composer-textarea').first()
    await composer.waitFor({ timeout: 30000 })
    await composer.click()
    await page.keyboard.type('hi mod')
    await page.keyboard.press('Enter')
    await page.getByText('ECHO AGENT SAYS: HI MOD').first().waitFor({ timeout: 30000 })
    // The sidebar lists the mod's session on its next poll.
    await page.getByText('Echo chat').first().waitFor({ timeout: 20000 })
    await shot('provider-mod')
  })
  results.push(errors.length ? `PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}` : 'no page errors')
} finally {
  await browser.close()
  console.log(results.join('\n'))
}
