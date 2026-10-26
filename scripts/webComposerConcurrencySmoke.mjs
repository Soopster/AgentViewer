import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const origin = process.env.WEB_COMPOSER_ORIGIN ?? 'http://127.0.0.1:3118'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
const sessions = ['alpha', 'beta'].map((sessionId, i) => ({ sessionId, provider: 'claude', summary: `Composer ${sessionId}`, firstPrompt: `Composer ${sessionId}`, cwd: '/synthetic/composer', lastModified: Date.now() - i * 1000 }))
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
let page
let alphaPersisted = false
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    let data = null
    if (url.pathname === '/api/provider') data = { provider: 'claude', providerInstanceId: 'claude', instances: [] }
    else if (url.pathname === '/api/sessions') data = { sessions }
    else if (url.pathname.endsWith('/coordination')) data = { snapshot: null, interactive: { enabled: false, autoContinue: false, remainingTurns: 0, delivery: null }, runningAgentIds: [], recoveries: [], deadAgents: [], permissions: [] }
    else if (url.pathname.endsWith('/messages')) {
      const id = url.pathname.split('/')[3]
      const messages = [{ type: 'assistant', uuid: `${id}-history`, session_id: id, parent_tool_use_id: null, provider: 'claude', message: { role: 'assistant', content: [{ type: 'text', text: `History for ${id}` }] } }]
      if (id === 'alpha' && alphaPersisted) messages.push({ type: 'user', uuid: 'ack-alpha', session_id: id, parent_tool_use_id: null, provider: 'claude', message: { role: 'user', content: [{ type: 'text', text: 'concurrent alpha' }] } })
      data = { messages, offset: 0, total: 1 }
    } else if (/^\/api\/sessions\/(alpha|beta)$/.test(url.pathname)) data = { info: sessions.find(s => s.sessionId === url.pathname.split('/')[3]) }
    if (data === null) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not available in fixture' }) })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window)
    window.__composerSends = []
    window.__composerStreams = new Map()
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin)
      if (!/^\/api\/sessions\/[^/]+\/messages$/.test(url.pathname) || options?.method !== 'POST') return nativeFetch(input, options)
      const id = url.pathname.split('/')[3]
      const body = JSON.parse(options.body)
      window.__composerSends.push({ id, body })
      return new Response(new ReadableStream({ start(controller) {
        const encoder = new TextEncoder()
        window.__composerStreams.set(id, { controller, event: data => controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(data)}\n\n`)) })
        controller.enqueue(encoder.encode('event: turn-accepted\ndata: {}\n\n'))
        options.signal?.addEventListener('abort', () => { window.__composerStreams.delete(id); controller.error(new DOMException('Stopped', 'AbortError')) }, { once: true })
      } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
  })
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  const select = async id => {
    await page.locator(`[data-session-key="claude:${id}"]`).first().click()
    await page.getByText(`History for ${id}`, { exact: true }).waitFor()
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor({ state: 'visible' })
    await page.waitForTimeout(100)
  }
  const send = async text => { const input = page.getByRole('textbox', { name: 'Message', exact: true }); await input.fill(text); await input.press('Enter') }
  await select('alpha')
  await send('concurrent alpha')
  await page.waitForFunction(() => window.__composerSends.length === 1)
  await page.evaluate(() => window.__composerStreams.get('alpha').event({ type: 'user', uuid: 'ack-alpha', session_id: 'alpha', message: { role: 'user', content: [{ type: 'text', text: 'concurrent alpha' }] } }))
  alphaPersisted = true
  await page.waitForTimeout(2300)
  assert.equal(await page.locator('[data-message-id]').filter({ hasText: 'concurrent alpha' }).count(), 1, 'persisted/provider acknowledgement duplicated optimistic echo')
  await select('beta')
  await send('concurrent beta')
  await page.waitForFunction(() => window.__composerSends.length === 2)
  assert.deepEqual(await page.evaluate(() => window.__composerSends.map(send => send.id)), ['alpha', 'beta'])
  assert.equal(await page.evaluate(() => window.__composerStreams.size), 2, 'switching sessions aborted another stream')
  await select('alpha')
  await send('alpha followup')
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => window.__composerSends.length), 2, 'same-session followup overlapped its first turn')
  await select('beta')
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('B unsent draft')
  await page.evaluate(() => { window.__composerStreams.get('alpha').controller.close(); window.__composerStreams.delete('alpha') })
  await page.waitForFunction(() => window.__composerSends.length === 3)
  assert.equal(await page.evaluate(() => window.__composerSends[2].id), 'alpha', 'background followup targeted another session')
  assert.equal(await page.evaluate(() => window.__composerStreams.has('beta')), true)
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).innerText(), 'B unsent draft', 'background completion cleared the active draft')
  await select('alpha')
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).innerText(), '', 'A inherited B draft')
  await page.getByRole('button', { name: 'Cancel send', exact: true }).click()
  await page.waitForFunction(() => !window.__composerStreams.has('alpha'))
  assert.equal(await page.evaluate(() => window.__composerStreams.has('beta')), true, 'cancelling A cancelled B')
  await select('beta')
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).innerText(), 'B unsent draft', 'returning to B lost its draft')
  await page.evaluate(() => { window.__composerStreams.get('beta').controller.close(); window.__composerStreams.delete('beta') })
  assert.deepEqual(errors, [])
  console.log('Web composer concurrency, active-session targeting, background followups, targeted cancellation, isolated drafts and provider-echo deduplication passed')
} catch (error) {
  if (page) { console.error((await page.locator('body').innerText()).slice(-3500)); console.error(await page.evaluate(() => window.__composerSends)) }
  throw error
} finally { await browser.close() }
