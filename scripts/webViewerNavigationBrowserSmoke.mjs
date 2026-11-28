import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-viewer-navigation-'))
let browser
let server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webViewerNavigationBrowserFixture.tsx'], bundle: true,
    platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent' })
  const script = await readFile(bundle)
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const click = async name => page.getByRole('button', { name, exact: true }).click()
  const read = async () => JSON.parse(await page.locator('output').textContent())
  await page.getByRole('button', { name: 'Alpha', exact: true }).waitFor()
  await click('Alpha')
  const resourceClears = (await read()).resourceClears
  await click('Queue beta and delete alpha')
  await page.getByTestId('active-content').getByText('Beta', { exact: true }).waitFor()
  assert.equal((await read()).resourceClears, resourceClears, 'an intermediate render cannot clear the pending target resource')
  assert.equal((await read()).clears, 0, 'a pending transition already owns the next selection intent')
  assert.equal((await read()).target, 'beta-anchor')
  assert.deepEqual((await read()).tabs.map(tab => tab.instance), ['personal'])
  await click('Alpha')
  await click('Dashboard')
  await click('Rename alpha')
  await page.getByTestId('active-content').getByText('Renamed alpha', { exact: true }).waitFor()
  assert.equal((await read()).dashboard, 'messaging')
  await click('Project')
  await click('Beta')
  await click('Complete project')
  await page.getByTestId('active-content').getByText('Beta', { exact: true }).waitFor()
  assert.equal((await read()).project, undefined)
  await click('Close both')
  await page.getByTestId('active-content').getByText('Empty', { exact: true }).waitFor()
  assert.equal((await read()).tabs.length, 0, 'consecutive close events use the latest tab set')
  await click('Pending')
  await click('Queue beta and materialize')
  await page.getByTestId('active-content').getByText('Beta', { exact: true }).waitFor()
  assert.equal((await read()).followed, false)
  assert.ok((await read()).tabs.some(tab => tab.id === 'materialized'))
  assert.equal((await read()).selected, 'personal:same')
  assert.equal(await page.locator('.av-session-tab.av-active').getAttribute('title'), 'Beta')
  await click('Pending')
  await click('Materialize')
  await page.getByTestId('active-content').getByText('Materialized', { exact: true }).waitFor()
  assert.equal((await read()).followed, true)
  assert.equal((await read()).tabs.filter(tab => tab.id === 'materialized').length, 1)
  await page.locator('.av-session-tab.av-active').getByRole('button', { name: 'Close tab', exact: true }).click()
  await page.getByTestId('active-content').getByText('Beta', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Web viewer navigation browser: queued selection/delete races, rendered context updates, stale project results, consecutive closes, and materialization focus passed')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
