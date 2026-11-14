import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'activity-island-browser-'))
let browser, server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webActivityIslandBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent', loader: { '.wasm': 'file' }, define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' } })
  const script = await readFile(bundle)
  const islandCss = await readFile(bundle.replace(/\.js$/, '.css'))
  const css = (await readFile('app/globals.css', 'utf8')).replace(/^@import[^;]+;/gm, '').replace(/@font-face\s*\{[^}]*\}/g, '')
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : `<!doctype html><html data-theme="dark"><style>${css}\n${islandCss}\nbody{background:var(--bg);color:var(--text);font-family:system-ui;padding:64px 24px}textarea{background:var(--surface);color:var(--text);padding:12px}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => route.fulfill({ json: { running: [{ provider: 'codex', providerInstanceId: 'work', sessionId: 'same' }], attention: [{ provider: 'codex', providerInstanceId: 'personal', sessionId: 'same' }], waiting: [] } }))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => !!window.activityFixture)
  const composer = page.getByRole('textbox', { name: 'Composer' })
  await composer.focus()
  const pill = page.locator('.activity-island-pill')
  await pill.getByText('Personal session', { exact: true }).waitFor()
  assert.equal(await composer.evaluate(node => node === document.activeElement), true, 'activity arrival never steals focus')
  await page.locator('#transcript').evaluate(node => { node.scrollTop = 400 })
  await pill.click()
  const dialog = page.getByRole('dialog', { name: 'Activity island', exact: true })
  await dialog.waitFor()
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, 'expanded view traps focus in the native dialog')
  await page.evaluate(() => window.activityFixture.error())
  await dialog.getByText('Build failed', { exact: true }).waitFor()
  assert.equal(await dialog.locator('li').first().locator('.activity-island-row-title').textContent(), 'Personal session', 'new priority item does not reorder rows while reading')
  await dialog.locator('li').filter({ hasText: 'Personal session' }).getByRole('button', { name: 'Open session', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => window.activityFixture.opened[0].providerInstanceId), 'personal', 'navigation preserves provider-instance identity')
  assert.equal(await page.locator('#transcript').evaluate(node => node.scrollTop), 400)
  await pill.click()
  await dialog.waitFor()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await pill.evaluate(node => node === document.activeElement), true, 'closing restores the trigger focus')
  await page.evaluate(() => window.activityFixture.disable())
  await pill.waitFor({ state: 'detached' })
  await page.evaluate(() => window.activityFixture.notify())
  await page.getByRole('complementary', { name: 'Notifications' }).getByText('Changes saved', { exact: true }).waitFor()
  await page.evaluate(() => window.activityFixture.loading())
  await page.getByText('Loading Codex…', { exact: true }).waitFor()
  await page.evaluate(() => window.activityFixture.enable())
  await pill.waitFor()
  assert.equal(await page.locator('[role="status"]').filter({ hasText: 'Loading Codex' }).count(), 0, 'provider loading popup yields to the island')
  await page.evaluate(() => window.activityFixture.finishLoading())
  await page.evaluate(() => window.activityFixture.run())
  await pill.click()
  await dialog.waitFor()
  await page.getByRole('progressbar', { name: 'Background build progress' }).waitFor()
  await page.screenshot({ path: '/private/tmp/agent-viewer-island-web.png', animations: 'disabled' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await dialog.evaluate(node => getComputedStyle(node).animationName), 'none')
  await page.setViewportSize({ width: 320, height: 600 })
  await page.evaluate(() => document.documentElement.dataset.theme = 'light')
  const bounds = await dialog.boundingBox()
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 320, 'dialog fits narrow viewport')
  await page.screenshot({ path: '/private/tmp/agent-viewer-island-mobile.png', animations: 'disabled' })
  assert.deepEqual(errors, [])
  console.log('Web activity island: PASS (real hosts, compact arrival, expansion, stable rows, qualified navigation, focus restoration, disable/re-enable, fallback, progress, reduced motion, narrow layout and transcript scroll)')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
