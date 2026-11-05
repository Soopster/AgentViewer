import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-shell-lifecycle-'))
let browser
let server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webShellLifecycleBrowserFixture.tsx'], bundle: true,
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
  await page.addInitScript(() => {
    localStorage.setItem('agentViewer:messagePaneCollapsed', '1')
    localStorage.setItem('coordinator:seen:v1:claude:alpha', '["seen"]')
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: 'Toggle pane', exact: true }).waitFor()
  const click = async name => page.getByRole('button', { name, exact: true }).click()
  const read = async () => JSON.parse(await page.locator('output').textContent())
  const waitRequests = async count => page.waitForFunction(count => window.__requests.length === count, count)
  const answer = async (index, attention) => page.evaluate(({ index, attention }) => window.__requests[index].resolve({ attention }), { index, attention })
  const blurredKey = async key => { await page.locator('output').click(); await page.keyboard.press(key) }
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).collapsed)
  assert.ok((await page.evaluate(() => window.__serverHtml)).includes('&quot;collapsed&quot;:false'))
  assert.deepEqual(await page.evaluate(() => window.__hydrationErrors), [])
  await click('Toggle pane')
  assert.equal((await read()).collapsed, false)
  assert.equal(await page.evaluate(() => localStorage.getItem('agentViewer:messagePaneCollapsed')), '0')
  for (const key of ['Control+b', 'Control+g', 'Control+Shift+g', 'Control+f', 'Control+k', 'Meta+k']) await blurredKey(key)
  assert.deepEqual((await read()).events, ['panel', 'git', 'pull-requests', 'files', 'palette', 'palette'])
  const consumed = page.getByRole('textbox', { name: 'Consumed shortcuts' })
  await consumed.focus()
  await page.keyboard.press('Control+b')
  assert.equal((await read()).events.length, 6, 'nested consumers can prevent shell shortcuts')
  await click('Toggle repository')
  await blurredKey('Control+g')
  await blurredKey('Control+Shift+g')
  await blurredKey('Control+f')
  assert.equal((await read()).events.length, 6, 'repository commands require a repository')
  await page.evaluate(() => window.__rejectFullscreen(true))
  await click('Fullscreen')
  assert.equal((await read()).maximized, true)
  assert.equal((await read()).fullscreen, false, 'browser denial preserves application focus mode')
  await consumed.focus()
  await page.keyboard.press('Escape')
  assert.equal((await read()).maximized, true, 'consumed Escape cannot dismiss focus mode')
  await blurredKey('Escape')
  assert.equal((await read()).maximized, false)
  await page.evaluate(() => window.__rejectFullscreen(false))
  await click('Fullscreen')
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).fullscreen)
  await click('Toggle maximize')
  await page.waitForFunction(() => !JSON.parse(document.querySelector('output').textContent).fullscreen)
  assert.equal((await read()).maximized, false)
  await click('Toggle eligibility')
  await click('Fullscreen')
  await click('Toggle maximize')
  assert.equal((await read()).maximized, false)
  assert.equal((await read()).fullscreen, false)

  await waitRequests(2)
  assert.equal(await page.evaluate(() => window.__requests[0].signal.aborted), true)
  const alpha = { sessionId: 'alpha', provider: 'claude', waiting: 1, finished: 2, resultIds: ['seen', 'fresh'] }
  const beta = { sessionId: 'beta', provider: 'codex', waiting: 0, finished: 1 }
  await answer(1, [alpha, beta])
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).attention['claude:alpha']?.finished === 1)
  await page.evaluate(() => { window.__previousAttention = window.__attention })
  await page.clock.runFor(5100)
  await waitRequests(3)
  await page.clock.runFor(5100)
  assert.equal(await page.evaluate(() => window.__requests.length), 3, 'attention requests cannot overlap')
  await answer(2, [beta, alpha])
  // A later event ensures React has flushed any resulting state update.
  await click('Toggle pane')
  assert.equal(await page.evaluate(() => window.__attention === window.__previousAttention), true, 'response order does not churn unchanged attention')
  await page.clock.runFor(5100)
  await waitRequests(4)
  await click('Toggle visibility')
  assert.equal((await read()).visible, false)
  assert.equal(await page.evaluate(() => window.__requests[3].signal.aborted), true)
  await page.clock.runFor(5100)
  assert.equal(await page.evaluate(() => window.__requests.length), 4)
  await click('Toggle visibility')
  await waitRequests(5)
  await answer(4, [beta])
  await page.waitForFunction(() => !JSON.parse(document.querySelector('output').textContent).attention['claude:alpha'])
  await answer(3, [{ ...alpha, waiting: 99 }])
  await click('Toggle pane')
  assert.equal((await read()).attention['claude:alpha'], undefined, 'obsolete visibility requests cannot restore stale marks')
  await page.clock.runFor(5100)
  await waitRequests(6)
  const count = (await read()).events.length
  await page.evaluate(() => window.__unmount())
  assert.equal(await page.evaluate(() => window.__requests[5].signal.aborted), true)
  await page.keyboard.press('Control+b')
  assert.equal(await page.evaluate(() => window.__events.length), count)
  await page.goto(`http://127.0.0.1:${server.address().port}/?hidden`)
  await page.waitForFunction(() => JSON.parse(document.querySelector('output').textContent).visible === false)
  assert.deepEqual(await page.evaluate(() => window.__hydrationErrors), [], 'hidden tabs hydrate the server snapshot first')
  assert.equal(await page.evaluate(() => window.__requests.every(request => request.signal.aborted)), true)
  await page.evaluate(() => window.__unmount())
  assert.deepEqual(errors, [])
  console.log('Web shell lifecycle browser: hydration, preferences, shortcut routing, consumed events, fullscreen fallback, attention identity, visibility cancellation, and cleanup passed')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
