import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-session-stream-'))
let browser
let server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webSessionMessageStreamBrowserFixture.tsx'], bundle: true,
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
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: 'Switch instance' }).waitFor()
  await page.waitForFunction(() => window.__streams.filter(source => !source.closed).length === 1)
  const read = async () => JSON.parse(await page.locator('output').textContent())
  await page.evaluate(() => {
    const source = window.__streams.at(-1)
    source.emit('todos', { sessionId: 'same-id', todos: [{ id: 'work-task', content: 'Work task', status: 'pending', priority: 'high' }] })
    source.emit('plan', { sessionId: 'same-id', plan: [{ step: 'Work plan', status: 'inProgress' }], explanation: 'Work only' })
  })
  await page.waitForFunction(() => document.querySelector('output').textContent.includes('Work plan'))
  const connections = await page.evaluate(() => window.__streams.length)
  await page.getByRole('button', { name: 'Refresh metadata' }).click()
  assert.equal(await page.evaluate(() => window.__streams.length), connections, 'metadata refresh should retain the connection')
  await page.getByRole('button', { name: 'Switch instance' }).click()
  await page.waitForFunction(() => window.__streams.at(-1).url.includes('personal'))
  assert.equal((await read()).todos, undefined)
  assert.equal((await read()).plan, undefined)
  await page.evaluate(() => {
    for (const source of window.__streams.filter(source => source.closed)) {
      source.emit('messages', { messages: [] })
      source.emit('plan', { sessionId: 'same-id', plan: [{ step: 'Stale work plan' }] })
    }
    window.__streams.at(-1).emit('todos', { sessionId: 'same-id', todos: [{ id: 'personal-task', content: 'Personal task' }] })
  })
  await page.waitForFunction(() => document.querySelector('output').textContent.includes('Personal task'))
  assert.equal((await read()).messages, 0)
  assert.equal((await read()).plan, undefined)
  await page.getByRole('button', { name: 'Toggle visibility' }).click()
  assert.equal(await page.evaluate(() => window.__streams.filter(source => !source.closed).length), 0)
  await page.getByRole('button', { name: 'Toggle visibility' }).click()
  await page.waitForFunction(() => window.__streams.filter(source => !source.closed).length === 1)
  await page.getByRole('button', { name: 'Toggle pending' }).click()
  assert.equal(await page.evaluate(() => window.__streams.filter(source => !source.closed).length), 0)
  await page.getByRole('button', { name: 'Toggle pending' }).click()
  await page.waitForFunction(() => window.__streams.filter(source => !source.closed).length === 1)
  await page.evaluate(() => window.__unmount())
  assert.equal(await page.evaluate(() => window.__streams.filter(source => !source.closed).length), 0)
  assert.deepEqual(errors, [])
  console.log('Web session stream browser: instance isolation, metadata stability, visibility, pending sessions, StrictMode, and unmount passed')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
