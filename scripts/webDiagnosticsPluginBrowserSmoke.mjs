import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-diagnostics-plugin-'))
let browser, server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webPluginCommandsBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent', loader: { '.wasm': 'file' },
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' },
  })
  const script = await readFile(bundle)
  const css = (await readFile('app/globals.css', 'utf8')).replace(/^@import[^;]+;/gm, '').replace(/@font-face\s*\{[^}]*\}/g, '')
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : `<!doctype html><html data-theme="dark"><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(15000)
  const errors = [], reads = [], actions = []
  let holdReads = false, releaseRead, actionFailure = false
  const pendingReads = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack) })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/diagnostics')) {
      const instance = url.searchParams.get('providerInstanceId')
      assert.equal(url.searchParams.get('provider'), 'claude')
      reads.push(instance)
      if (holdReads) await new Promise(resolve => { pendingReads.push(resolve); releaseRead = () => { for (const release of pendingReads.splice(0)) release() } })
      return route.fulfill({ json: { sections: [
        { id: 'status', title: 'STATUS', items: [`DIAGNOSTICS-${instance}`] },
        { id: 'mcp', title: 'MCP', items: ['fixture-mcp · connected · dynamic'] },
        { id: 'hooks', title: 'HOOKS', items: ['Initial hook'] },
      ] } }).catch(() => {})
    }
    if (url.pathname.endsWith('/actions') && request.method() === 'POST') {
      const body = request.postDataJSON()
      actions.push(body)
      if (actionFailure) return route.fulfill({ status: 500, json: { error: 'Fixture action failed' } })
      return route.fulfill({ json: { result: body.action === 'listHookEvents' ? { events: [{ timestamp: 'now', summary: `HOOK-${body.query}` }] } : { sourceCount: 2, effectiveKeyCount: 4 } } })
    }
    return route.fulfill({ json: { models: [], commands: [], permissions: [], subagents: [], sessions: [], tools: [], messages: [] } })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}/?provider=claude`, { waitUntil: 'domcontentloaded' })
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.waitFor()
  assert.equal(reads.length, 0, 'browsing a session must not activate diagnostics')
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Session diagnostics', exact: true })
  await dialog.getByText('DIAGNOSTICS-personal', { exact: true }).waitFor()
  const initialReads = reads.length
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.locator('[data-timeline-key]').getByText('Original work prompt', { exact: true }).waitFor()
  assert.equal(reads.length, initialReads, 'selection changes do not activate another runtime')
  await dialog.getByRole('button', { name: 'RELOAD SKILLS', exact: true }).click()
  await dialog.getByRole('status').getByText('Skills reloaded.', { exact: true }).waitFor()
  assert.equal(actions.at(-1).providerInstanceId, 'personal', 'an open diagnostics view keeps its captured account')
  assert.equal(actions.at(-1).provider, 'claude')
  await dialog.getByRole('textbox', { name: 'Search Claude hook timeline' }).fill('review')
  await dialog.getByRole('button', { name: 'SEARCH', exact: true }).click()
  await dialog.getByText('now · HOOK-review', { exact: true }).waitFor()
  await dialog.getByRole('combobox', { name: 'Permission policy for MCP server fixture-mcp' }).selectOption('auto')
  await page.waitForFunction(() => document.querySelector('select[aria-label="Permission policy for MCP server fixture-mcp"]').value === 'auto')
  assert.equal(actions.at(-1).providerInstanceId, 'personal')
  assert.equal(actions.at(-1).mode, 'auto')
  actionFailure = true
  await dialog.getByRole('button', { name: 'RECONN', exact: true }).click()
  await dialog.getByRole('alert').getByText('Fixture action failed', { exact: true }).waitFor()
  actionFailure = false
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  holdReads = true
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click()
  await eventually(() => !!releaseRead)
  await page.getByRole('button', { name: 'Disable diagnostics', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  holdReads = false
  releaseRead()
  await page.waitForTimeout(100)
  const previousActions = actions.length
  await page.getByRole('button', { name: 'Enable diagnostics', exact: true }).click()
  await dialog.getByText('DIAGNOSTICS-work', { exact: true }).waitFor()
  assert.equal(await dialog.getByText('DIAGNOSTICS-personal', { exact: true }).count(), 0, 'late disabled reads cannot leak across accounts')
  assert.equal(actions.length, previousActions, 're-enabling never repeats an old mutation')
  await dialog.getByRole('button', { name: 'Close', exact: true }).press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log('Web diagnostics plugin: PASS (real MessageView, StrictMode, lazy reads, captured account, controls, errors, late reads, disable/re-enable and Escape)')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
async function eventually(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(predicate(), 'condition did not settle')
}
