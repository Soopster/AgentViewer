import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-application-plugin-'))
let browser, server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webApplicationPluginBrowserFixture.tsx'], bundle: true, platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent',
    plugins: [{ name: 'isolate-alert-view', setup(build) {
      build.onLoad({ filter: /components\/shell\/pluginViews\.ts$/ }, () => ({ resolveDir: process.cwd(), loader: 'ts', contents: `
        import { createPluginViewRegistry } from './lib/plugins/activation'
        import { manifest } from './plugins/session-alerts/manifest'
        globalThis.__alertViewLoads = 0
        export const webPluginViews = createPluginViewRegistry('web', {
          'session-alerts': async () => { globalThis.__alertViewLoads++; return (await import('./plugins/session-alerts/web')).module }
        }, [], [manifest])`,
      }))
    } }],
  })
  const script = await readFile(bundle)
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    globalThis.__permissionRequests = 0
    globalThis.__desktop = []
    window.Notification = class {
      static permission = 'default'
      static async requestPermission() { globalThis.__permissionRequests++; this.permission = 'granted'; return 'granted' }
      constructor(title, options) { globalThis.__desktop.push({ title, body: options.body }) }
    }
    document.hasFocus = () => true
  })
  let requests = 0
  let activity = { running: [], waiting: [], attention: [] }
  await page.route('**/api/sessions/running', route => { requests++; return route.fulfill({ json: activity }) })
  await page.clock.install()
  const initialRead = page.waitForResponse('**/api/sessions/running')
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: 'Open alerts' }).waitFor()
  await initialRead
  assert.equal(await page.evaluate(() => globalThis.__alertViewLoads), 0, 'observation must not load UI')
  await page.clock.runFor(100)
  activity = { running: [{ sessionId: 'same', provider: 'claude', providerInstanceId: 'work', pendingPrompts: [{}], pendingPermissions: [] }], waiting: [], attention: [] }
  await page.clock.runFor(2600)
  await page.getByRole('status').filter({ hasText: 'Work needs you' }).waitFor()
  assert.equal(await page.evaluate(() => globalThis.__permissionRequests), 0)
  assert.equal(await page.evaluate(() => globalThis.__alertViewLoads), 0)
  await page.getByRole('button', { name: 'Disable observer' }).click()
  const disabledRequests = requests
  await page.clock.runFor(8000)
  assert(requests > disabledRequests, 'the shell keeps the shared runtime feed live for app inspection while observers are disabled')
  assert.equal(await page.getByRole('status').count(), 0)
  await page.getByRole('button', { name: 'Enable observer' }).click()
  await page.clock.runFor(2600)
  assert.equal(await page.getByRole('status').count(), 0, 're-enable must not replay disabled activity')
  await page.getByRole('button', { name: 'Open alerts' }).click()
  const dialog = page.getByRole('dialog', { name: 'Session alerts' })
  await dialog.getByRole('button', { name: 'desktop', exact: true }).click()
  assert.equal(await page.evaluate(() => globalThis.__permissionRequests), 0, 'choosing a mode alone does not prompt')
  await dialog.getByRole('button', { name: 'Allow desktop notifications' }).click()
  assert.equal(await page.evaluate(() => globalThis.__permissionRequests), 1)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }))
  // Each step waits for the poll it triggers: polls are real (routed) fetches
  // under a fake clock, and advancing the clock past one still in flight let
  // the observer miss the turn under load.
  const poll = async (ms) => { const served = page.waitForResponse('**/api/sessions/running'); await page.clock.runFor(ms); await served; await page.clock.runFor(50) }
  activity = { running: [{ sessionId: 'same', provider: 'claude', providerInstanceId: 'work', pendingPrompts: [], pendingPermissions: [] }], waiting: [], attention: [] }
  await poll(2600)
  await poll(16000)
  activity = { running: [], waiting: [], attention: [] }
  await poll(2600)
  await page.waitForFunction(() => globalThis.__desktop.length === 1)
  assert.match((await page.evaluate(() => globalThis.__desktop[0])).body, /Work finished/)
  assert.deepEqual(errors, [])
  console.log('Web application plugin: PASS (view-independent delivery, configured accounts, disable/re-enable, explicit permission and background long-turn notification)')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
