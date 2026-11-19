import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'plugin-manager-search-'))
let browser, server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webPluginManagerSearchBrowserFixture.tsx'], bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', outfile: bundle, logLevel: 'silent', define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' } })
  const script = await readFile(bundle)
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : '<!doctype html><html><style>:root{--surface:#151519;--surface-2:#202026;--border:#35353f;--border-2:#484851;--text:#ededf3;--text-2:#aaaab8;--violet:#b097ff}body{background:#0c0c10;color:var(--text);font:14px system-ui}button,input{font:inherit}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
  const errors = [], mutations = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/plugins', route => {
    const body = route.request().postDataJSON()
    mutations.push(body)
    return route.fulfill({ json: { version: 1, disabled: body.enabled ? [] : [body.id] } })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const trigger = page.getByRole('button', { name: 'Open plugins' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Plugins', exact: true })
  const search = dialog.getByRole('searchbox', { name: 'Search plugins' })
  await search.waitFor()
  assert.equal(await search.evaluate(node => node === document.activeElement), true)
  const titles = await dialog.locator('[data-plugin-row] label').allTextContents()
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })), 'loaded plugins are alphabetical across features, providers and mods')
  await search.fill('TOGGLE activity island')
  assert.equal(await dialog.locator('[data-plugin-row]').count(), 1)
  const toggle = dialog.locator('[data-plugin-row="dynamic-island"]').getByRole('switch')
  await toggle.click()
  await page.waitForFunction(() => document.querySelector('[data-plugin-row="dynamic-island"] [role="switch"]')?.getAttribute('aria-checked') === 'false')
  assert.deepEqual(mutations, [{ id: 'dynamic-island', enabled: false }])
  const filters = dialog.getByRole('group', { name: 'Filter plugins' })
  await filters.getByRole('button', { name: 'Enabled', exact: true }).click()
  assert.equal(await filters.getByRole('button', { name: 'Enabled', exact: true }).getAttribute('aria-pressed'), 'true')
  await dialog.getByText('No matching plugins.', { exact: true }).waitFor()
  await filters.getByRole('button', { name: 'Disabled', exact: true }).click()
  await toggle.waitFor()
  await toggle.click()
  await dialog.getByText('No matching plugins.', { exact: true }).waitFor()
  await filters.getByRole('button', { name: 'All', exact: true }).click()
  await toggle.waitFor()
  await search.fill('never-a-plugin')
  await dialog.getByText('No matching plugins.', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('switch').count(), 0)
  await dialog.getByRole('button', { name: 'Clear plugin search' }).click()
  assert.equal(await dialog.locator('[data-plugin-row]').count(), titles.length)
  await search.fill('provider codex')
  assert.equal(await dialog.locator('[data-plugin-row]').count(), 2)
  await search.fill('local verification')
  assert.equal(await dialog.locator('[data-plugin-row="my-checks"]').count(), 1)
  await search.fill('syntax failure')
  await dialog.locator('[data-plugin-refused="broken-mod"]').waitFor()
  await filters.getByRole('button', { name: 'Disabled', exact: true }).click()
  await dialog.getByText('No matching plugins.', { exact: true }).waitFor()
  await filters.getByRole('button', { name: 'All', exact: true }).click()
  await dialog.locator('[data-plugin-refused="broken-mod"]').waitFor()
  assert.equal(await dialog.locator('[data-plugin-row]').count(), 0)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true)
  await trigger.click()
  await search.waitFor()
  assert.equal(await search.inputValue(), '', 'new manager opens with a fresh query')
  await page.setViewportSize({ width: 340, height: 640 })
  await search.fill('dynamic island')
  const bounds = await dialog.boundingBox()
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 340)
  await page.screenshot({ path: '/private/tmp/agent-viewer-plugin-search.png' })
  assert.deepEqual(errors, [])
  console.log('Web plugin manager: PASS (alphabetical order, focus, live filtering, filtered toggles, counts/empty state, clear, providers, local/refused mods, Escape and narrow layout)')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
