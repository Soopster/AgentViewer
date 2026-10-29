import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-transcript-tail-'))
let server
let browser
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webTranscriptTailBrowserFixture.tsx'], bundle: true, format: 'esm',
    platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent', loader: { '.wasm': 'file' },
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' } })
  const script = await readFile(bundle)
  const css = (await readFile('app/globals.css', 'utf8')).replace(/^@import[^;]+;/gm, '').replace(/@font-face\s*\{[^}]*\}/g, '')
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : `<!doctype html><html data-theme="dark"><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.route('**/api/**', route => route.fulfill({ json: { models: [], commands: [], permissions: [], subagents: [], sessions: [], tools: [] } }))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.locator('[data-timeline-key]').first().waitFor()
  const viewport = await page.evaluate(() => {
    let node = document.querySelector('[data-timeline-key]').parentElement
    while (node && getComputedStyle(node).overflowY !== 'auto') node = node.parentElement
    if (!node) throw new Error('No transcript scroll container')
    node.dataset.tailScroller = 'true'
    const bounds = node.getBoundingClientRect()
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  })
  await page.waitForTimeout(1200)
  const follow = page.getByRole('button', { name: /follow live/i })
  if (await follow.count()) await follow.click()
  await page.waitForTimeout(700)
  await page.mouse.move(viewport.x, viewport.y)
  await page.evaluate(() => {
    window.__tailFrames = []
    window.__tailPhase = 'wheel'
    window.__tailRecording = true
    const sample = () => {
      if (!window.__tailRecording) return
      const node = document.querySelector('[data-tail-scroller]')
      const last = [...node.querySelectorAll('[data-timeline-key]')].at(-1)
      window.__tailFrames.push({ phase: window.__tailPhase, top: node.scrollTop, height: node.scrollHeight,
        lastBottom: last?.getBoundingClientRect().bottom,
        following: node.textContent.includes('waiting for new messages') })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  for (let index = 0; index < 20; index++) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(35)
  }
  await page.waitForTimeout(600)
  await page.evaluate(() => { window.__tailPhase = 'growth' })
  for (let index = 0; index < 20; index++) {
    await page.evaluate(() => window.dispatchEvent(new Event('fixture-grow')))
    await page.waitForTimeout(80)
  }
  await page.waitForTimeout(600)
  const frames = await page.evaluate(() => { window.__tailRecording = false; return window.__tailFrames })
  const jumps = frames.slice(1).map((frame, index) => frame.top - frames[index].top)
  console.log(JSON.stringify({ frames: frames.length, minimumDelta: Math.min(...jumps), maximumDelta: Math.max(...jumps), errors }))
  for (const phase of ['wheel', 'growth']) {
    const samples = frames.filter(frame => frame.phase === phase)
    const differences = samples.slice(1).map((frame, index) => frame.top - samples[index].top)
    console.log(JSON.stringify({ phase, minimumDelta: Math.min(...differences), maximumDelta: Math.max(...differences),
      minimumBottom: Math.min(...samples.map(frame => frame.lastBottom)), maximumBottom: Math.max(...samples.map(frame => frame.lastBottom)) }))
  }
  await writeFile('/private/tmp/web-transcript-tail-frames.json', JSON.stringify(frames, null, 2))
  await page.screenshot({ path: '/private/tmp/web-transcript-tail.png' })
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
