import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'agent-viewer-tips-'))
let browser, server
try {
  await build({ entryPoints: ['scripts/tipsBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: path.join(directory, 'fixture.js'), logLevel: 'silent', loader: { '.wasm': 'file' }, define: { 'process.env.NODE_ENV': '"development"' } })
  const script = await readFile(path.join(directory, 'fixture.js'))
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : '<!doctype html><html style="background:#1e222a;--surface:#292e38;--text-2:#a9b1bd;--amber:#eaaa40"><div id="root"></div><script type="module" src="/fixture.js"></script></html>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 820, height: 300 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-11-16T00:00:00Z') })
  await page.addInitScript(() => { Math.random = () => 0 })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const rows = page.locator('[data-rows]'), tip = page.locator('[data-feature-tip]')
  await rows.getByText('0', { exact: true }).waitFor()
  await page.clock.pauseAt(new Date('2026-11-16T00:01:00Z'))
  const draft = page.getByRole('textbox', { name: 'Draft' })
  await draft.fill('My unchanged draft')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.clock.runFor(7999)
  assert.equal(await tip.count(), 0)
  await page.clock.runFor(1)
  await tip.waitFor()
  assert.equal(await rows.textContent(), '1')
  assert.equal(await draft.inputValue(), 'My unchanged draft')
  const bounds = await draft.boundingBox(), hint = await tip.boundingBox()
  assert.ok(hint.y >= bounds.y + bounds.height, 'tip belongs below the input')
  await page.screenshot({ path: '/private/tmp/agent-viewer-tips-web.png' })
  await page.setViewportSize({ width: 280, height: 300 })
  assert.ok(await tip.evaluate(element => element.scrollWidth > element.clientWidth), 'long tip truncates at narrow widths')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow')
  await page.getByRole('button', { name: 'Attention', exact: true }).click()
  assert.equal(await tip.count(), 0)
  assert.equal(await rows.textContent(), '0')
  await page.getByRole('button', { name: 'Settle', exact: true }).click()
  await page.clock.runFor(300000)
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.clock.runFor(8000)
  await tip.waitFor()
  assert.ok(!(await tip.textContent()).includes('token budget'), 'next display rotates to another feature')
  await page.getByRole('button', { name: 'Toggle Tips', exact: true }).click()
  assert.equal(await tip.count(), 0)
  assert.equal(await rows.textContent(), '0')
  await page.getByRole('button', { name: 'Toggle Tips', exact: true }).click()
  await page.clock.runFor(9000)
  assert.equal(await tip.count(), 0, 're-enable must not replay')
  assert.deepEqual(errors, [])
  console.log('Web tips: PASS (real footer host in StrictMode, delay, rows, rotation, disable/re-enable, draft preservation, narrow layout)')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
