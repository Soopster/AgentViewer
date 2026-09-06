import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { writeFileSync } from 'node:fs'

const origin = process.env.WEB_PERF_ORIGIN ?? 'http://127.0.0.1:3107'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'performance harness requires localhost')
const size = Number(process.env.WEB_PERF_ROWS ?? 100)
const messageCount = Number(process.env.WEB_PERF_MESSAGES ?? 100)
const contentKind = process.env.WEB_PERF_CONTENT ?? 'text'
const toolLines = Number(process.env.WEB_PERF_TOOL_LINES ?? 100)
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
if (contentKind === 'mixed') {
  for (let i = 0; i < messageCount; i++) {
    const message = messages[i]
    if (i % 4 === 1) {
      message.message.content.push({ type: 'tool_use', id: `tool-${i}`, name: 'Bash', input: { command: `cat fixture-${i}.txt` } })
    } else if (i % 4 === 2) {
      message.message.content = [{ type: 'tool_result', tool_use_id: `tool-${i - 1}`, content: `Fixture output ${i}\n${'tool output line\n'.repeat(toolLines)}` }]
    } else if (i % 4 === 3) {
      message.message.content = [{ type: 'text', text: `Fixture turn ${i}\n\n## Result\n\n- First finding\n- Second finding\n\n\`\`\`typescript\n${'const result = calculate(input)\n'.repeat(20)}\`\`\`\n\nCompleted the analysis.` }]
    }
  }
}
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
      const id = url.pathname.split('/')[3]
      data = { messages: messages.slice(offset, offset + limit).map(message => id === 'perf-0' ? message : {
        ...message, uuid: `${id}:${message.uuid}`, session_id: id,
      }), offset, total: messageCount }
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
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const report = async (workload, started) => {
    await settle()
    console.log(JSON.stringify({ workload, contentKind, messages: messageCount, durationMs: performance.now() - started,
      mountedTranscriptRows: await page.locator('[data-timeline-key]').count(),
      longTasks: await page.evaluate(() => window.__webPerfLongTasks) }))
    await page.evaluate(() => { window.__webPerfLongTasks = [] })
  }
  const start = performance.now()
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-session-key="codex:perf-0"]').waitFor({ timeout: 30_000 })
  const readyMs = performance.now() - start
  console.log(JSON.stringify({ workload: 'browser-sidebar-ready', contentKind, sessions: size, readyMs,
    domNodes: await page.locator('*').count(), mountedSessionRows: await page.locator('[data-session-key]').count(),
    longTasks: await page.evaluate(() => window.__webPerfLongTasks), errors, apiRequests: [...apiRequests] }))
  const search = page.getByPlaceholder('Search title, tags, path, prompt…')
  const searchStarted = performance.now()
  await search.fill('Performance session 0')
  await page.waitForFunction(() => document.querySelectorAll('[data-session-key]').length === 1)
  console.log(JSON.stringify({ workload: 'browser-sidebar-filter', contentKind, sessions: size, durationMs: performance.now() - searchStarted,
    mountedSessionRows: await page.locator('[data-session-key]').count() }))
  assert.equal(await page.locator('[data-session-key="codex:perf-0"]').count(), 1)
  // The sidebar filter is independent of transcript search; clear it before
  // opening so the selected session's transcript controls can mount.
  await search.fill('')
  await page.waitForFunction(() => document.querySelectorAll('[data-session-key]').length >= 2)
  await page.evaluate(() => { window.__webPerfLongTasks = [] })
  const profiler = process.env.WEB_PERF_PROFILE ? await context.newCDPSession(page) : null
  if (profiler) {
    await profiler.send('Profiler.enable')
    await profiler.send('Profiler.start')
  }
  const openStarted = performance.now()
  await page.locator('[data-session-key="codex:perf-0"]').click()
  await page.locator(`[data-message-id="message-${messageCount - 1}"]`).waitFor({ timeout: 30_000 })
  if (profiler) {
    const { profile } = await profiler.send('Profiler.stop')
    writeFileSync(process.env.WEB_PERF_PROFILE, JSON.stringify(profile))
    await profiler.detach()
  }
  console.log(JSON.stringify({ workload: 'browser-transcript-open', contentKind, messages: messageCount,
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
  console.log(JSON.stringify({ workload: 'browser-composer-type-two-frames', contentKind, messages: messageCount, samplesMs: typingSamples,
    longTasks: await page.evaluate(() => window.__webPerfLongTasks) }))
  await page.evaluate(() => { window.__webPerfLongTasks = [] })
  const transcriptSearch = page.getByPlaceholder('Search turns, tools, paths, commands…')
  const searchTurn = `Fixture turn ${messageCount - 1}`
  let started = performance.now()
  await transcriptSearch.fill(searchTurn)
  await page.waitForFunction(() => document.querySelectorAll('[data-timeline-key]').length === 1)
  assert.equal(await page.locator(`[data-message-id="message-${messageCount - 1}"]`).count(), 1)
  await report('browser-transcript-search', started)
  started = performance.now()
  await transcriptSearch.fill('')
  await page.waitForFunction(() => document.querySelectorAll('[data-timeline-key]').length > 1)
  await report('browser-transcript-search-clear', started)
  for (const mode of ['STREAM', 'AGENTS', 'CONT', 'FULL']) {
    started = performance.now()
    await page.locator('button').filter({ hasText: 'VIEW' }).first().click()
    await page.locator('button').filter({ hasText: mode }).last().click()
    await page.locator('[data-timeline-key]').first().waitFor()
    await report(`browser-mode-${mode.toLowerCase()}`, started)
    const scroller = await page.locator('[data-timeline-key]').first().evaluate(row => {
      let node = row.parentElement
      while (node && !(['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight)) node = node.parentElement
      if (!node) throw new Error('Transcript scroll container not found')
      node.dataset.perfScroll = 'true'
      node.scrollTop = node.scrollHeight
      const rect = node.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, top: node.scrollTop }
    })
    await page.mouse.move(scroller.x, scroller.y)
    await page.evaluate(() => {
      window.__webPerfFrames = []
      window.__webPerfSampling = true
      let previous
      const sample = time => {
        if (previous !== undefined) window.__webPerfFrames.push(time - previous)
        previous = time
        if (window.__webPerfSampling) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    for (let scroll = 0; scroll < 12; scroll++) {
      await page.mouse.wheel(0, -700)
      await settle()
    }
    await page.waitForFunction(() => {
      const viewport = document.querySelector('[data-perf-scroll]').getBoundingClientRect()
      return [...document.querySelectorAll('[data-timeline-key]')].some(row => {
        const rect = row.getBoundingClientRect()
        return rect.bottom > viewport.top && rect.top < viewport.bottom && row.textContent.includes('Fixture')
      })
    }, undefined, { timeout: 10_000 })
    const scrollMetrics = await page.evaluate(() => {
      window.__webPerfSampling = false
      const node = document.querySelector('[data-perf-scroll]')
      const top = node.scrollTop
      delete node.dataset.perfScroll
      return { top, distanceFromBottom: node.scrollHeight - node.clientHeight - top,
        framesMs: window.__webPerfFrames, longTasks: window.__webPerfLongTasks }
    })
    // Measured row heights can increase absolute scrollTop while preserving
    // the reading anchor; upward input must leave the tail, not decrease an
    // absolute coordinate whose estimates are still settling.
    assert.ok(scrollMetrics.distanceFromBottom > 100, `${mode}: wheel input must leave the transcript tail (${JSON.stringify(scrollMetrics)})`)
    console.log(JSON.stringify({ workload: `browser-scroll-${mode.toLowerCase()}`, contentKind, messages: messageCount, ...scrollMetrics,
      mountedTranscriptRows: await page.locator('[data-timeline-key]').count() }))
    await page.evaluate(() => { window.__webPerfLongTasks = [] })
  }
  if (process.env.WEB_PERF_MEMORY === '1') {
    assert.ok(size >= 2, 'memory workload requires two sessions')
    const cdp = await context.newCDPSession(page)
    const snapshots = []
    for (let cycle = 0; cycle < 12; cycle++) {
      const id = `perf-${(cycle + 1) % 2}`
      await search.fill(`Performance session ${(cycle + 1) % 2}`)
      await page.locator(`[data-session-key="codex:${id}"]`).click()
      const uuid = `${id === 'perf-0' ? '' : `${id}:`}message-${messageCount - 1}`
      await page.locator(`[data-message-id="${uuid}"]`).waitFor()
      await settle()
      await cdp.send('HeapProfiler.collectGarbage')
      const heap = await cdp.send('Runtime.getHeapUsage')
      const dom = await cdp.send('Memory.getDOMCounters')
      snapshots.push({ cycle, id, usedBytes: heap.usedSize, ...dom })
    }
    console.log(JSON.stringify({ workload: 'browser-session-switch-retained-memory', contentKind, messages: messageCount, snapshots }))
    await cdp.detach()
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
