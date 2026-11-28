import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-plugin-commands-'))
let browser, server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webPluginCommandsBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent', loader: { '.wasm': 'file' },
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' },
    plugins: [{ name: 'deferred-command-module', setup(build) {
      build.onLoad({ filter: /components\/shell\/pluginCommands\.ts$/ }, () => ({ resolveDir: process.cwd(), loader: 'ts', contents: `
        globalThis.__actionLoads = 0
        export const webPluginCommands = { bridges: async () => (await import('./plugins/bridges/commands')).commands, goals: async () => (await import('./plugins/goals/commands')).commands, 'composer-tools': async () => {
          globalThis.__actionLoads++
          if (globalThis.__actionLoads === 1) await new Promise(resolve => { globalThis.__releaseAction = resolve })
          const module = (await import('./plugins/composer-tools/commands')).commands
          globalThis.__actionReady = true
          return module
        } }`,
      }))
    } }],
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
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.route('**/api/**', route => route.fulfill({ json: { models: [], commands: [], permissions: [], subagents: [], sessions: [], tools: [] } }))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.waitFor()
  assert.equal(await page.evaluate(() => globalThis.__actionLoads), 0)
  await input.fill('Personal draft')
  await page.getByRole('button', { name: 'Run reuse', exact: true }).click()
  await page.waitForFunction(() => typeof globalThis.__releaseAction === 'function')
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.locator('[data-timeline-key]').getByText('Original work prompt', { exact: true }).waitFor()
  await input.fill('Keep work draft')
  await page.evaluate(() => globalThis.__releaseAction())
  await page.waitForFunction(() => globalThis.__actionReady === true)
  await page.waitForTimeout(200)
  assert.equal(await input.textContent(), 'Keep work draft', 'old account command cannot overwrite the new composer')
  await page.getByRole('button', { name: 'Run reuse', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="Message"]').textContent === 'Original work prompt')
  assert.equal(await input.textContent(), 'Original work prompt')
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.locator('[data-timeline-key]').getByText('Original personal prompt', { exact: true }).waitFor()
  assert.equal(await input.textContent(), 'Personal draft', 'cancelled work cannot change the parked source composer either')
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.locator('[data-timeline-key]').getByText('Original work prompt', { exact: true }).waitFor()
  assert.equal(await input.textContent(), 'Original work prompt')
  await page.getByRole('button', { name: 'Disable tools', exact: true }).click()
  await input.fill('Manual draft')
  await page.getByRole('button', { name: 'Run reuse', exact: true }).click()
  assert.equal(await page.getByTestId('handled').textContent(), 'false')
  assert.equal(await input.textContent(), 'Manual draft')
  await page.getByRole('button', { name: 'Enable tools', exact: true }).click()
  await page.getByRole('button', { name: 'Run reuse', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="Message"]').textContent === 'Original work prompt')
  assert.equal(await page.evaluate(() => globalThis.__actionLoads), 2)
  await page.getByRole('button', { name: 'Open messaging command', exact: true }).click()
  assert.equal(await page.getByTestId('dashboard').textContent(), 'messaging', 'a session view cannot intercept an application dashboard command')
  assert.equal(await page.getByRole('heading', { name: 'Cross-Session Messaging' }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('Web executable plugin commands: PASS (real MessageView, StrictMode, lazy action, account-switch cancellation, target-bound reuse and disable/re-enable)')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
