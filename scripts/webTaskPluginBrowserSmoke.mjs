import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-task-plugin-'))
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
  const errors = [], stops = []
  let releaseStop, held = false
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack) })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/actions') && request.method() === 'POST') {
      const body = request.postDataJSON()
      if (body.action === 'stopTask') {
        stops.push(body)
        if (held) await new Promise(resolve => { releaseStop = resolve })
        return route.fulfill({ json: { result: { stopped: body.providerInstanceId === 'personal' } } }).catch(() => {})
      }
    }
    return route.fulfill({ json: { models: [], commands: [], permissions: [], subagents: [], sessions: [], tools: [], messages: [] } })
  })
  const base = `http://127.0.0.1:${server.address().port}`
  await page.goto(`${base}/?provider=claude&tasks`, { waitUntil: 'domcontentloaded' })
  const rail = page.getByRole('complementary', { name: 'Tasks', exact: true })
  await rail.getByText('Task personal', { exact: true }).waitFor()
  const slot = page.locator('[data-plugin-reader-slot="tasks"]')
  assert.equal(Math.round((await slot.boundingBox()).width), 360)
  await rail.getByRole('button', { name: 'Close task panel', exact: true }).click()
  await rail.waitFor({ state: 'detached' })
  assert.equal(Math.round((await slot.boundingBox()).width), 0)
  await page.getByRole('button', { name: 'Open task command', exact: true }).click()
  await rail.getByText('Task personal', { exact: true }).waitFor()
  held = true
  await rail.getByRole('button', { name: 'Stop task #task-1', exact: true }).click()
  await eventually(() => !!releaseStop)
  assert.equal(stops[0].provider, 'claude')
  assert.equal(stops[0].providerInstanceId, 'personal')
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await rail.getByText('Task work', { exact: true }).waitFor()
  releaseStop()
  held = false
  await page.waitForTimeout(100)
  assert.equal(await slot.getByText('Stopped task #task-1.', { exact: true }).count(), 0, 'old account stop cannot notify the replacement rail')
  await rail.getByRole('button', { name: 'Stop task #task-1', exact: true }).click()
  await slot.getByRole('alert').getByText('No running task to stop (session not warm).', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Disable tasks', exact: true }).click()
  await rail.waitFor({ state: 'detached' })
  assert.equal(await slot.count(), 0)
  await page.getByRole('button', { name: 'Enable tasks', exact: true }).click()
  await rail.getByText('Task work', { exact: true }).waitFor()
  assert.equal(stops.length, 2, 're-enable never replays a stop action')
  await page.getByRole('button', { name: 'Toggle task data', exact: true }).click()
  await rail.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Toggle task command', exact: true }).click()
  await rail.getByText('no tasks in this session', { exact: true }).waitFor()
  await rail.getByRole('button', { name: 'Close task panel', exact: true }).click()
  await rail.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Open task command', exact: true }).click()
  await rail.getByText('no tasks in this session', { exact: true }).waitFor()
  await page.goto(`${base}/?provider=claude&tasks&project`, { waitUntil: 'domcontentloaded' })
  await rail.getByText('Task personal', { exact: true }).waitFor()
  assert.equal(await rail.getByRole('button', { name: 'Stop task #task-1', exact: true }).count(), 0, 'project feed remains read-only')
  assert.deepEqual(errors, [])
  console.log('Web task plugin: PASS (real MessageView, reader geometry, close/open/toggle, empty state, account-bound stop, late response, local error, disable/re-enable and read-only project)')

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
