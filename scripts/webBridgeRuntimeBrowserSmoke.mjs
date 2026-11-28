import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-bridge-runtime-'))
let browser, server
const streams = { channel: new Set(), ide: new Set() }
const deliveries = []
let releasePending
const historyReads = []
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webPluginCommandsBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent', loader: { '.wasm': 'file' },
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' },
  })
  const script = await readFile(bundle)
  const css = (await readFile('app/globals.css', 'utf8')).replace(/^@import[^;]+;/gm, '').replace(/@font-face\s*\{[^}]*\}/g, '')
  server = createServer(async (request, response) => {
    const kind = request.url.startsWith('/channel/') ? 'channel' : request.url.startsWith('/ide/') ? 'ide' : null
    if (kind && request.url.includes('/events')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
      response.write(': ready\n\n')
      if (kind === 'ide') response.write('data: {"type":"connected"}\n\n')
      streams[kind].add(response)
      response.on('close', () => streams[kind].delete(response))
      return
    }
    if (kind && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += chunk
      deliveries.push({ kind, path: request.url, body: JSON.parse(body || '{}') })
      if (deliveries.at(-1).body.text === 'Pending personal message') await new Promise(resolve => { releasePending = resolve })
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ chat_id: 'fixture-chat', message_id: 'fixture-message', queued: false, status: 'processed', delivered: true }))
      return
    }
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : `<!doctype html><html data-theme="dark"><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(15000)
  const errors = [], providerSends = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack) })
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/bridge-messages' && route.request().method() === 'GET') historyReads.push(url.searchParams.get('providerInstanceId'))
    if (route.request().method() === 'POST' && new URL(route.request().url()).pathname.endsWith('/messages')) providerSends.push(route.request().postDataJSON())
    return route.fulfill({ json: { models: [], commands: [], permissions: [], subagents: [], sessions: [], tools: [], messages: [] } })
  })
  const base = `http://127.0.0.1:${server.address().port}`
  await page.addInitScript(base => {
    localStorage.setItem('agentviewer:channel-bridge-config', JSON.stringify({ baseUrl: base + '/channel', token: '' }))
    localStorage.setItem('agentviewer:ide-bridge-config', JSON.stringify({ baseUrl: base + '/ide', token: '' }))
  }, base)
  await page.goto(`${base}/?provider=claude`, { waitUntil: 'domcontentloaded' })
  const message = page.getByRole('textbox', { name: 'Message', exact: true })
  await message.waitFor()
  assert.equal(streams.channel.size + streams.ide.size, 0, 'closed presentation and unrouted composer own no connection')
  await page.getByRole('button', { name: 'CLI bridge', exact: true }).click()
  const channel = page.getByRole('region', { name: 'Live CLI bridge', exact: true })
  await channel.waitFor()
  await eventually(() => streams.channel.size === 1)
  await channel.getByPlaceholder('Message the live CLI session…').fill('Pending personal message')
  await channel.getByRole('button', { name: 'Send to live CLI session', exact: true }).click()
  await eventually(() => Boolean(releasePending))
  await page.getByRole('button', { name: 'Switch account', exact: true }).evaluate(button => button.click())
  await eventually(() => historyReads.includes('work'))
  await channel.waitFor()
  releasePending()
  await page.waitForTimeout(150)
  assert.equal(await channel.getByText('Pending personal message', { exact: false }).count(), 0, 'old account completion cannot append to the current bridge log')
  assert.equal(await channel.getByRole('button', { name: 'Send to live CLI session', exact: true }).isEnabled(), false, 'new account has an empty independent draft')
  await channel.getByPlaceholder('Message the live CLI session…').fill('Current work message')
  await channel.getByRole('button', { name: 'Send to live CLI session', exact: true }).click()
  await channel.getByText('Current work message', { exact: false }).waitFor({ state: 'attached' })
  assert.equal(await channel.getByText('Pending personal message', { exact: false }).count(), 0, 'settled old send remains absent after current send completes')
  assert.ok(historyReads.includes('personal') && historyReads.includes('work'), 'history reads capture configured account identity')
  await channel.getByText('Route composer through bridge', { exact: true }).click()
  await page.waitForFunction(() => localStorage.getItem('agentviewer:channel-bridge-route-composer') === '1')
  await channel.getByRole('button', { name: 'Close', exact: true }).click()
  await channel.waitFor({ state: 'detached' })
  assert.equal(streams.channel.size, 1, 'closing the view retains a routed runtime subscription')
  await message.fill('Send through retained bridge')
  await message.press('Enter')
  await eventually(() => deliveries.some(delivery => delivery.kind === 'channel' && delivery.body.text === 'Send through retained bridge'))
  assert.equal(providerSends.length, 0, 'routing uses the bridge instead of provider SDK submission')
  await page.getByRole('button', { name: 'Disable bridges', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'CLI bridge', exact: true }).count(), 0)
  assert.equal(streams.channel.size, 1, 'disabling presentation does not drop composer routing')
  await page.getByRole('button', { name: 'Toggle CLI route command', exact: true }).click()
  assert.equal(await page.evaluate(() => localStorage.getItem('agentviewer:channel-bridge-route-composer')), '1')
  await page.getByRole('button', { name: 'Enable bridges', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle CLI route command', exact: true }).click()
  await page.waitForFunction(() => localStorage.getItem('agentviewer:channel-bridge-route-composer') === '0')
  await eventually(() => streams.channel.size === 0)
  await page.getByRole('button', { name: 'IDE bridge', exact: true }).click()
  const ide = page.getByRole('region', { name: 'IDE bridge', exact: true })
  await ide.waitFor()
  await eventually(() => streams.ide.size === 1)
  await ide.getByText('Route composer through IDE', { exact: true }).click()
  await page.waitForFunction(() => localStorage.getItem('agentviewer:ide-bridge-route-composer') === '1')
  await ide.getByRole('button', { name: 'Close', exact: true }).click()
  await ide.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Disable bridges', exact: true }).click()
  assert.equal(streams.ide.size, 1)
  await page.getByRole('button', { name: 'Enable bridges', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle IDE route command', exact: true }).click()
  await page.waitForFunction(() => localStorage.getItem('agentviewer:ide-bridge-route-composer') === '0')
  await eventually(() => streams.ide.size === 0)
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await message.waitFor()
  assert.equal(await page.getByRole('button', { name: 'CLI bridge', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'IDE bridge', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('Web bridge runtime: PASS (real MessageView/hooks, actual SSE transport, account-switch isolation, view leases, retained routing, composer delivery, command routing and provider availability)')

} finally {
  await browser?.close()
  for (const set of Object.values(streams)) for (const response of set) response.destroy()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
async function eventually(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(predicate(), 'condition did not settle')
}
