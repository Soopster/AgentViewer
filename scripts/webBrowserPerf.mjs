import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const origin = process.env.WEB_PERF_ORIGIN ?? 'http://127.0.0.1:3107'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'performance harness requires localhost')
const size = Number(process.env.WEB_PERF_ROWS ?? 100)
const messageCount = Number(process.env.WEB_PERF_MESSAGES ?? 100)
const sessions = Array.from({ length: size }, (_, i) => ({
  sessionId: `perf-${i}`, provider: 'codex', summary: `Performance session ${i}`,
  firstPrompt: `Investigate fixture ${i}`, cwd: '/synthetic/performance',
  lastModified: 1_700_000_000_000 + i * 1000,
}))
const messages = Array.from({ length: messageCount }, (_, i) => ({
  type: i % 2 === 0 ? 'user' : 'assistant', uuid: `message-${i}`, session_id: 'perf-0',
  parent_tool_use_id: null, provider: 'codex', timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
  message: { role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text: `Fixture turn ${i}\n\n${'Readable transcript content. '.repeat(20)}` }] },
}))
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
  const apiRequests = new Set()
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    apiRequests.add(url.pathname)
    let data = {}
    if (url.pathname === '/api/provider') data = { provider: 'codex', providerInstanceId: 'codex', instances: [] }
    else if (url.pathname === '/api/sessions') data = { sessions }
    else if (url.pathname.endsWith('/messages')) {
      const limit = Number(url.searchParams.get('limit') ?? messageCount)
      const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset'))
        : url.searchParams.get('tail') === '1' ? Math.max(0, messageCount - limit) : 0
      data = { messages: messages.slice(offset, offset + limit), offset, total: messageCount }
    }
    else if (/^\/api\/sessions\/perf-\d+$/.test(url.pathname)) data = { info: sessions[Number(url.pathname.split('-').at(-1))] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.__webPerfLongTasks = []
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__webPerfLongTasks.push({ start: entry.startTime, duration: entry.duration })
    }).observe({ type: 'longtask', buffered: true })
  })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const start = performance.now()
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-session-key="codex:perf-0"]').waitFor({ timeout: 30_000 })
  const readyMs = performance.now() - start
  console.log(JSON.stringify({ workload: 'browser-sidebar-ready', sessions: size, readyMs,
    domNodes: await page.locator('*').count(), mountedSessionRows: await page.locator('[data-session-key]').count(),
    longTasks: await page.evaluate(() => window.__webPerfLongTasks), errors, apiRequests: [...apiRequests] }))
  const search = page.getByPlaceholder('Search title, tags, path, prompt…')
  const searchStarted = performance.now()
  await search.fill('Performance session 0')
  await page.waitForFunction(() => document.querySelectorAll('[data-session-key]').length === 1)
  console.log(JSON.stringify({ workload: 'browser-sidebar-filter', sessions: size, durationMs: performance.now() - searchStarted,
    mountedSessionRows: await page.locator('[data-session-key]').count() }))
  assert.equal(await page.locator('[data-session-key="codex:perf-0"]').count(), 1)
  await page.evaluate(() => { window.__webPerfLongTasks = [] })
  const openStarted = performance.now()
  await page.locator('[data-session-key="codex:perf-0"]').click()
  await page.locator(`[data-message-id="message-${messageCount - 1}"]`).waitFor({ timeout: 30_000 })
  console.log(JSON.stringify({ workload: 'browser-transcript-open', messages: messageCount,
    durationMs: performance.now() - openStarted, mountedTranscriptRows: await page.locator('[data-timeline-key]').count(),
    domNodes: await page.locator('*').count(), longTasks: await page.evaluate(() => window.__webPerfLongTasks), errors }))
  await page.evaluate(() => { window.__webPerfLongTasks = [] })
  const composer = page.locator('textarea').filter({ visible: true }).first()
  await composer.fill('')
  await composer.focus()
  const typingSamples = []
  for (const key of 'performance') {
    const started = performance.now()
    await page.keyboard.type(key)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    typingSamples.push(performance.now() - started)
  }
  assert.equal(await composer.inputValue(), 'performance')
  console.log(JSON.stringify({ workload: 'browser-composer-type-two-frames', messages: messageCount, samplesMs: typingSamples,
    longTasks: await page.evaluate(() => window.__webPerfLongTasks) }))
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
