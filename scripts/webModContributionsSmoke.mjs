import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
const temp = await mkdtemp(path.join(tmpdir(), 'web-mod-contributions-'))
let server, browser
try {
  await build({ entryPoints: ['scripts/webModContributionsFixture.tsx'], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'fixture.js'), logLevel: 'silent', plugins: [{ name: 'no-bundled-widget-fixture', setup(build) { build.onLoad({ filter: /components\/shell\/widgetPlugins\.ts$/ }, () => ({ loader: 'js', contents: 'export const webPluginWidgets={peek(){},load(){throw new Error("Bundled widgets are disabled in this fixture")}}' })) } }] })
  const script = await readFile(path.join(temp, 'fixture.js'))
  server = createServer((req, res) => { res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/fixture.js' ? script : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>') })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByText('Local panel body', { exact: true }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0, 'panel adapter must not draw overlay chrome')
  for (const [slot, id] of [['corner', 'corner'], ['top-center', 'center'], ['viewport', 'notice']]) {
    await page.locator(`[data-plugin-widget-slot="${slot}"] [data-plugin-widget="web-contributor:${id}"]`).waitFor()
    assert.equal(await page.locator(`[data-plugin-widget="web-contributor:${id}"]`).count(), 1)
  }
  assert.equal(await page.evaluate(() => window.widgetReads()), 1, 'all slots must share a poll')
  await page.getByRole('button', { name: 'Toggle mod' }).click()
  assert.equal(await page.locator('[data-plugin-widget^="web-contributor:"]').count(), 0)
  await page.getByRole('button', { name: 'Toggle mod' }).click()
  await page.locator('[data-plugin-widget="web-contributor:center"]').waitFor()
  assert.equal(await page.evaluate(() => window.widgetReads()), 2)
  assert.deepEqual(errors, [])
  console.log('Web mod contributions: PASS (panel adapter without overlay chrome, named widget slots, single poller, disable/re-enable)')
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }) }
