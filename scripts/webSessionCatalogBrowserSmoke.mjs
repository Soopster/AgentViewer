import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-session-catalog-'))
let browser
let server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webSessionCatalogBrowserFixture.tsx'], bundle: true,
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
  await page.getByRole('button', { name: 'Toggle enabled', exact: true }).waitFor()
  const read = async () => JSON.parse(await page.locator('output').textContent())
  const click = async name => page.getByRole('button', { name, exact: true }).click()
  const requests = async () => page.evaluate(() => window.__requests.map(({ url, init }) => ({ url, aborted: init?.signal?.aborted })))
  const waitRequests = async count => page.waitForFunction(count => window.__requests.length === count, count)
  const answer = async (index, sessions, status = 200) => page.evaluate(({ index, sessions, status }) => window.__requests[index].resolve({ sessions }, status), { index, sessions, status })
  const work = { sessionId: 'shared', provider: 'codex', providerInstanceId: 'work', customTitle: 'Work', lastModified: 1 }
  const personal = { ...work, providerInstanceId: 'personal', customTitle: 'Personal' }
  assert.equal((await requests()).length, 0, 'disabled binding must not start a query')
  await click('Toggle enabled')
  await waitRequests(1)
  await click('Switch instance')
  await waitRequests(2)
  assert.equal((await requests())[0].aborted, true)
  await click('Mutate other instance')
  assert.equal((await requests())[1].aborted, false, 'a late action for another instance cannot cancel this query')
  assert.equal(new URL((await requests())[1].url, 'http://localhost').searchParams.get('providerInstanceId'), 'personal')
  await answer(0, [work])
  assert.equal((await read()).loading, true, 'an obsolete load cannot finish the new query')
  await answer(1, [personal])
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).sessions[0]?.customTitle === 'Personal')
  assert.equal((await read()).loading, false)
  await click('Rerender')
  assert.equal((await requests()).length, 2, 'new query object with identical fields does not refetch')
  await click('Refresh twice')
  await waitRequests(3)
  assert.equal((await read()).loading, false, 'background refresh keeps the current list visible')
  await click('Rename')
  assert.equal((await requests())[2].aborted, true)
  await answer(2, [{ ...personal, customTitle: 'Stale before rename' }])
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).sessions[0]?.customTitle === 'Optimistic')
  await click('Toggle scope')
  await waitRequests(4)
  const scoped = new URL((await requests())[3].url, 'http://localhost')
  assert.equal(scoped.searchParams.get('dir'), '/alpha')
  assert.equal(scoped.searchParams.get('includeWorktrees'), 'true')
  await answer(3, [personal])
  await page.waitForFunction(() => !JSON.parse(document.querySelector('output').textContent).loading)
  await click('Toggle visibility')
  await page.clock.runFor(5100)
  assert.equal((await requests()).length, 4, 'hidden documents suspend polling')
  await click('Toggle visibility')
  await page.clock.runFor(5100)
  await waitRequests(5)
  await page.clock.runFor(5100)
  assert.equal((await requests()).length, 5, 'slow polling requests are deduplicated')
  await answer(4, [{ ...personal, customTitle: 'Background updated', inbox: { pinnedAt: 1 } }])
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).sessions[0]?.customTitle === 'Background updated')
  await click('Toggle scope')
  await waitRequests(6)
  await answer(5, [], 500)
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).error === 'HTTP 500')
  assert.equal((await read()).loading, false)
  await click('Refresh twice')
  await waitRequests(7)
  await answer(6, [personal])
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).error === null)
  await click('Refresh twice')
  await waitRequests(8)
  await page.evaluate(() => window.__unmount())
  assert.equal((await requests())[7].aborted, true)
  await answer(7, [work])
  await page.evaluate(() => window.__refreshCatalog())
  assert.equal((await requests()).length, 8, 'late plugin callbacks cannot restart queries after unmount')
  // Mount with an enabled query to exercise StrictMode setup/cleanup replay.
  await page.goto(`http://127.0.0.1:${server.address().port}/?enabled`)
  await waitRequests(2)
  assert.equal((await requests())[0].aborted, true)
  assert.equal((await requests())[1].aborted, false)
  await answer(0, [personal])
  assert.equal((await read()).loading, true)
  await answer(1, [work])
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).sessions[0]?.customTitle === 'Work')
  await page.evaluate(() => window.__unmount())
  assert.deepEqual(errors, [])
  console.log('Web session catalog browser: query cancellation, request deduplication, optimistic edits, visibility, errors, and unmount passed')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
