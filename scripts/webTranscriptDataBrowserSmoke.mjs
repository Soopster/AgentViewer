import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-transcript-data-'))
let browser
let server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webTranscriptDataBrowserFixture.tsx'], bundle: true,
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
  await page.getByRole('button', { name: 'Session A', exact: true }).waitFor()
  const read = async () => JSON.parse(await page.locator('output').textContent())
  const click = async name => page.getByRole('button', { name, exact: true }).click()
  const requests = async () => page.evaluate(() => window.__requests.map(({ url, init }) => ({ url, aborted: init?.signal?.aborted, body: init?.body })))
  const waitRequests = async count => page.waitForFunction(count => window.__requests.length === count, count)
  const answer = async (index, body) => page.evaluate(({ index, body }) => window.__requests[index].resolve(body), { index, body })
  const message = (uuid, sessionId) => ({ uuid, session_id: sessionId, type: 'assistant', provider: 'codex', providerInstanceId: 'work',
    parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'text', text: uuid }] } })
  const batch = (dir, uuid) => ({ sessions: [{ sessionId: dir, summary: uuid, provider: 'codex' }],
    batches: [{ key: `work:${dir}`, offset: 100, messages: [message(uuid, dir)] }] })

  await click('Session A')
  await waitRequests(1)
  await click('Session B')
  await waitRequests(2)
  assert.equal((await requests())[0].aborted, true)
  await answer(1, { offset: 900, messages: [message('b-current', 'b')], externalWriter: true })
  await page.waitForFunction(() => document.querySelector('output').textContent.includes('b-current'))
  await answer(0, { messages: [message('a-stale', 'a')] })
  assert.deepEqual((await read()).messages, ['b-current'])
  assert.equal((await read()).externalWriter, true)
  await page.evaluate(() => window.__streams.filter(source => !source.closed).at(-1).onerror())
  await waitRequests(3)
  assert.ok((await requests())[2].url.includes('offset=881'), 'fallback uses the absolute tail offset')
  await click('Project alpha')
  await waitRequests(4)
  assert.equal((await requests())[2].aborted, true)
  await answer(2, { messages: [message('b-stale-poll', 'b')] })
  await click('Project beta')
  await waitRequests(5)
  assert.equal((await requests())[3].aborted, true)
  assert.equal((await read()).loading, true)
  await answer(3, batch('/alpha', 'alpha-stale'))
  assert.equal((await read()).loading, true, 'an obsolete load cannot clear the new loading state')
  await answer(4, batch('/beta', 'beta-current'))
  await page.waitForFunction(() => document.querySelector('output').textContent.includes('beta-current'))
  assert.deepEqual((await read()).messages, ['beta-current'])
  assert.equal((await read()).metadata, '/beta:beta-current')
  await page.clock.runFor(2100)
  await waitRequests(6)
  const poll = JSON.parse((await requests())[5].body)
  assert.equal(poll.dir, '/beta')
  assert.equal(poll.providerInstanceId, 'work')
  assert.equal(poll.offsets['work:/beta'], 81)
  await page.clock.runFor(2100)
  assert.equal((await requests()).length, 6, 'project poll requests cannot overlap')
  await click('Session B')
  await waitRequests(7)
  assert.equal((await requests())[5].aborted, true)
  await answer(5, batch('/beta', 'beta-stale-poll'))
  await answer(6, { offset: 0, messages: [message('b-return', 'b')] })
  await page.waitForFunction(() => document.querySelector('output').textContent.includes('b-return'))
  assert.equal((await read()).metadata, '/beta:beta-current', 'an aborted project poll cannot update navigation metadata')
  await click('Deep link')
  await waitRequests(8)
  assert.ok((await requests())[7].url.includes('all=1'))
  await answer(7, { messages: [message('anchored', 'b')] })
  await page.waitForFunction(() => document.querySelector('output').textContent.includes('anchored'))
  await click('Pending')
  assert.equal((await requests()).length, 8, 'pending sessions do not read provider transcripts')
  assert.deepEqual((await read()).messages, [])
  assert.equal((await read()).loading, false)
  await click('Project alpha')
  await waitRequests(9)
  await click('Clear')
  assert.equal((await requests())[8].aborted, true)
  await answer(8, batch('/alpha', 'alpha-cleared'))
  assert.deepEqual((await read()).messages, [])
  assert.equal((await read()).target, null)
  await click('Session A')
  await waitRequests(10)
  await page.evaluate(() => window.__unmount())
  assert.equal((await requests())[9].aborted, true)
  assert.equal(await page.evaluate(() => window.__streams.filter(source => !source.closed).length), 0)
  assert.deepEqual(errors, [])
  console.log('Web transcript data browser: session/project load races, fallback cancellation, project poll guards, deep links, pending sessions, clear, and unmount passed')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
