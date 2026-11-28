import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-provider-selection-'))
let browser
let server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webProviderSelectionBrowserFixture.tsx'], bundle: true,
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
  await page.getByRole('button', { name: 'Choose work', exact: true }).waitFor()
  const click = async name => page.getByRole('button', { name, exact: true }).click()
  const read = async () => JSON.parse(await page.locator('output').textContent())
  const requests = async () => page.evaluate(() => window.__requests.map(({ url, init }) => ({ url, method: init?.method ?? 'GET', body: init?.body, aborted: init?.signal?.aborted })))
  const waitRequests = async count => page.waitForFunction(count => window.__requests.length === count, count)
  const answer = async (index, body, status = 200) => page.evaluate(({ index, body, status }) => window.__requests[index].resolve(body, status), { index, body, status })
  const waitSelection = async (provider, instance) => page.waitForFunction(({ provider, instance }) => {
    const output = JSON.parse(document.querySelector('output').textContent)
    return output.provider === provider && output.instance === instance
  }, { provider, instance })

  // StrictMode restoration replay: only the latest read can publish a default.
  await waitRequests(2)
  assert.equal((await requests())[0].aborted, true)
  await answer(0, { provider: 'pi', providerInstanceId: 'stale' })
  assert.equal((await read()).ready, false)
  await answer(1, { provider: 'codex', providerInstanceId: 'personal', instances: [{ id: 'personal', provider: 'codex', label: 'Personal' }] })
  await waitSelection('codex', 'personal')
  await waitRequests(3)
  assert.equal((await read()).instances.length, 1)
  assert.equal(new URL((await requests())[2].url, 'http://localhost').searchParams.get('providerInstanceId'), 'personal')
  await answer(2, { sessions: [] })
  await click('Toggle scope')
  await waitRequests(4)
  assert.equal((await requests()).filter(request => request.url === '/api/provider').length, 2, 'scope changes must not restore the default again')
  await answer(3, { sessions: [] })
  await click('Choose twice')
  await waitRequests(5)
  assert.equal((await read()).switching, true)
  assert.deepEqual(JSON.parse((await requests())[4].body), { provider: 'codex', providerInstanceId: 'work' })
  await click('Adopt session')
  await waitSelection('opencode', 'local')
  await waitRequests(6)
  await click('Choose personal')
  assert.equal((await requests()).length, 6, 'persisted writes remain serialized after local navigation')
  await answer(4, { provider: 'codex', providerInstanceId: 'work' })
  await page.waitForFunction(() => !JSON.parse(document.querySelector('output').textContent).switching)
  assert.equal((await read()).provider, 'opencode')
  assert.equal((await read()).resets, 0, 'a superseded switch cannot clear current navigation')
  await answer(5, { sessions: [] })
  await click('Choose work')
  await waitRequests(7)
  await answer(6, { error: 'Unavailable' }, 500)
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).error === 'HTTP 500')
  assert.equal((await read()).provider, 'opencode')
  assert.equal((await read()).switching, false)
  await click('Choose work')
  await waitRequests(8)
  await answer(7, {})
  await waitSelection('codex', 'work')
  await waitRequests(9)
  assert.equal((await read()).error, null)
  assert.equal((await read()).resets, 1)
  await answer(8, { sessions: [] })
  await click('Choose all')
  await waitRequests(10)
  assert.deepEqual(JSON.parse((await requests())[9].body), { provider: 'all' })
  await answer(9, {})
  await waitSelection('all', 'all')
  await waitRequests(11)
  assert.equal(new URL((await requests())[10].url, 'http://localhost').searchParams.has('providerInstanceId'), false)
  await answer(10, { sessions: [] })
  await click('Choose work')
  await waitRequests(12)
  await page.evaluate(() => window.__unmount())
  assert.equal((await requests())[11].aborted, true)
  await answer(11, {})

  // A user navigation that wins before restoration completes owns the UI.
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await waitRequests(2)
  await click('Adopt session')
  await waitSelection('opencode', 'local')
  await waitRequests(3)
  await answer(1, { provider: 'codex', providerInstanceId: 'work', instances: [{ id: 'work', provider: 'codex', label: 'Work' }] })
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).instances.length === 1)
  assert.equal((await read()).provider, 'opencode')
  assert.equal((await requests())[1].aborted, false)
  await answer(2, { sessions: [] })
  await page.evaluate(() => window.__unmount())
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await waitRequests(2)
  await answer(1, { error: 'Restore failed' }, 503)
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).ready)
  await waitRequests(3)
  assert.equal((await read()).provider, 'claude')
  assert.equal((await read()).error, 'HTTP 503')
  assert.ok((await requests())[2].url.includes('provider=claude'))
  await answer(2, { sessions: [] })
  await page.evaluate(() => window.__unmount())
  assert.deepEqual(errors, [])
  console.log('Web provider selection browser: restoration, atomic queries, scope independence, serialized writes, superseded switches, errors, all-provider mode, and unmount passed')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
