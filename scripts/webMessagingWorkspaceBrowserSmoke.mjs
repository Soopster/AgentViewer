import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-messaging-workspace-'))
let browser
let server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webMessagingWorkspaceBrowserFixture.tsx'], bundle: true,
    platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent',
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' } })
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
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.clock.install()
  await page.goto(`http://127.0.0.1:${server.address().port}/?to=b`)
  await page.getByRole('heading', { name: 'Cross-Session Messaging' }).waitFor()
  const waitRequests = async count => page.waitForFunction(count => window.__requests.length === count, count)
  const requests = async () => page.evaluate(() => window.__requests.map(({ url, init }) => ({ url, body: init?.body, aborted: init?.signal?.aborted })))
  const answer = async (index, body, status = 200) => page.evaluate(({ index, body, status }) => window.__requests[index].resolve(body, status), { index, body, status })
  const alpha = { sessionId: 'a', provider: 'claude', name: 'alpha-name', title: 'Alpha destination', running: true }
  const beta = { sessionId: 'b', provider: 'codex', name: 'beta-name', title: 'Beta destination', running: false }
  const destination = title => page.locator('.av-messaging-session').filter({ hasText: title })
  const message = page.getByRole('textbox', { name: 'Message', exact: true })
  const submit = page.getByRole('button', { name: 'Send Message', exact: true })
  await waitRequests(2)
  assert.equal((await requests())[0].aborted, true)
  assert.equal(await page.getByRole('link', { name: 'Back to Sessions' }).count(), 0)
  assert.equal(await page.getByRole('main').count(), 0)
  await answer(1, { sessions: [alpha, beta] })
  await destination('Alpha destination').waitFor()
  assert.equal(await destination('Alpha destination').getAttribute('aria-pressed'), 'true', 'embedded messaging ignores the host route query')
  await message.fill('Message for Alpha')
  assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), true)
  await submit.click()
  await waitRequests(3)
  assert.deepEqual(JSON.parse((await requests())[2].body), { to: 'a', text: 'Message for Alpha', fromName: 'Agent Viewer' })
  await destination('Beta destination').click()
  assert.equal(new URL(page.url()).searchParams.get('to'), 'b')
  await destination('Alpha destination').click()
  assert.equal(new URL(page.url()).searchParams.get('to'), 'b', 'embedded selection must not change the dashboard URL')
  await destination('Beta destination').click()
  await answer(2, { delivered: true, mode: 'steered', targetName: 'Alpha destination' })
  await waitRequests(4)
  await submit.waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('textarea').disabled)
  assert.equal(await message.inputValue(), 'Message for Alpha', 'old delivery cannot clear the newer destination draft')
  assert.equal(await page.getByText('Delivered to Alpha destination.', { exact: true }).count(), 0)
  await answer(3, { sessions: [alpha, beta] })
  await message.fill('Message for Beta')
  await page.locator('form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await waitRequests(5)
  assert.equal(JSON.parse((await requests())[4].body).to, 'b')
  await answer(4, { delivered: false, mode: 'error', error: 'Fixture delivery failed' }, 409)
  await page.getByText('Fixture delivery failed', { exact: true }).waitFor()
  assert.equal(await message.inputValue(), 'Message for Beta')
  await submit.click()
  await waitRequests(6)
  await answer(5, { delivered: true, mode: 'queued', targetName: 'Beta destination' })
  await page.getByText('Started a new turn for Beta destination.', { exact: true }).waitFor()
  assert.equal(await message.inputValue(), '')
  await waitRequests(7)
  await answer(6, { sessions: [alpha, beta] })
  assert.equal(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), false)
  await page.clock.runFor(5100)
  await waitRequests(8)
  await page.clock.runFor(5100)
  assert.equal((await requests()).length, 8)
  await page.getByRole('button', { name: 'Toggle visibility' }).click()
  assert.equal((await requests())[7].aborted, true)
  await page.clock.runFor(5100)
  assert.equal((await requests()).length, 8)
  await page.getByRole('button', { name: 'Toggle visibility' }).click()
  await waitRequests(9)
  await answer(8, { sessions: [alpha, beta] })
  await answer(7, { sessions: [] })
  await destination('Beta destination').waitFor()
  await message.fill('Unmount while sending')
  await submit.click()
  await waitRequests(10)
  await page.evaluate(() => window.__unmount())
  assert.equal((await requests())[9].aborted, true)
  await answer(9, { delivered: true, mode: 'queued' })

  await page.goto(`http://127.0.0.1:${server.address().port}/?standalone&to=beta-name`)
  await waitRequests(2)
  await answer(1, { sessions: [alpha, beta] })
  await destination('Beta destination').waitFor()
  assert.equal(await destination('Beta destination').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('main').count(), 1)
  await page.getByRole('link', { name: 'Back to Sessions' }).waitFor()
  await destination('Alpha destination').click()
  assert.equal(new URL(page.url()).searchParams.get('to'), 'a')
  assert.equal(new URL(page.url()).searchParams.has('standalone'), true)
  await page.evaluate(() => window.__unmount())
  assert.deepEqual(errors, [])
  console.log('Web messaging workspace browser: route isolation, destination changes during delivery, duplicate submits, errors, drafts, visibility cancellation, standalone links, and unmount passed')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
