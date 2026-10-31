import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-session-creation-'))
let browser
let server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webSessionCreationBrowserFixture.tsx'], bundle: true,
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
  const waitRequests = async count => page.waitForFunction(count => window.__requests.length === count, count)
  const answer = async (index, body, status = 200) => page.evaluate(({ index, body, status }) => window.__requests[index].resolve(body, status), { index, body, status })
  await page.getByRole('button', { name: 'Alpha', exact: true }).waitFor()
  await click('Alpha')
  await click('Create twice')
  await waitRequests(1)
  assert.deepEqual(await page.evaluate(() => JSON.parse(window.__requests[0].body)), { provider: 'codex', providerInstanceId: 'work', cwd: '/alpha' })
  assert.deepEqual(await page.evaluate(() => window.__loadingProviders()), ['codex'])
  await click('Beta')
  await answer(0, { sessionId: 'background-created', isPending: true })
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).tabs.includes('background-created'))
  await page.getByTestId('active-content').getByText('Beta', { exact: true }).waitFor()
  assert.equal((await read()).creating, false)
  assert.deepEqual(await page.evaluate(() => window.__loadingProviders()), [])
  await click('Create')
  await waitRequests(2)
  assert.deepEqual(await page.evaluate(() => JSON.parse(window.__requests[1].body)), { provider: 'codex', providerInstanceId: 'personal', cwd: '/beta' })
  await answer(1, { sessionId: 'foreground-created', isPending: true })
  await page.getByTestId('active-content').getByText('New session', { exact: true }).waitFor()
  assert.equal((await read()).selected.sessionId, 'foreground-created')
  assert.equal((await read()).selected.providerInstanceId, 'personal')
  assert.equal((await read()).selected.cwd, '/beta')
  assert.equal((await read()).selected.isPending, true)
  await click('Create')
  await waitRequests(3)
  await click('Provider intent')
  await answer(2, { error: 'Stale failure' }, 500)
  await page.waitForFunction(() => !JSON.parse(document.querySelector('output').textContent).creating)
  assert.equal((await read()).error, null)
  await click('Create')
  await waitRequests(4)
  await answer(3, { error: 'Provider unavailable' }, 500)
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).error === 'Provider unavailable')
  assert.equal((await read()).creating, false)
  assert.deepEqual(await page.evaluate(() => window.__loadingProviders()), [])
  await click('Beta')
  assert.equal((await read()).error, null, 'creation errors belong to their original navigation intent')
  await click('Create')
  await waitRequests(5)
  await answer(4, {})
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).error === 'Session creation did not return a session ID.')
  await click('Create')
  await waitRequests(6)
  assert.deepEqual(await page.evaluate(() => window.__loadingProviders()), ['codex'])
  await page.evaluate(() => window.__unmount())
  assert.equal(await page.evaluate(() => window.__requests[5].signal.aborted), true)
  assert.deepEqual(await page.evaluate(() => window.__loadingProviders()), [])
  await answer(5, { sessionId: 'after-unmount' })
  await page.evaluate(() => window.__createSaved())
  assert.equal(await page.evaluate(() => window.__requests.length), 6)
  assert.deepEqual(await page.evaluate(() => window.__loadingProviders()), [])
  assert.deepEqual(errors, [])
  console.log('Web session creation browser: duplicate requests, target snapshots, background retention, pending sessions, current/stale errors, loading cleanup, and unmount passed')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
