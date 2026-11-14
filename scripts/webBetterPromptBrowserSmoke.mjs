import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
const directory = await mkdtemp(path.join(tmpdir(), 'web-better-'))
let browser, server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webBetterPromptBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } })
  const script = await readFile(bundle)
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : '<!doctype html><html style="--surface:#16191e;--surface-2:#22272f;--text-1:#eee;--text-3:#aaa;--cyan:#65cfe2;--border:#505560"><div id="root"></div><script type="module" src="/fixture.js"></script></html>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  page.setDefaultTimeout(10000)
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  let release, pending = false
  await page.route('**/api/**', async route => {
    if (!route.request().url().endsWith('/better')) return route.fulfill({ json: { goal: null } })
    requests.push(route.request().postDataJSON())
    pending = true
    await new Promise(resolve => { release = resolve })
    pending = false
    const progress = { stage: 3, startedAt: Date.now() - 87000, total: 2, failed: 1, tools: [{ id: '1', label: 'read docs/raw.md', status: 'ok' }, { id: '2', label: 'grep TODO', status: 'error' }] }
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'progress', value: progress })}\n\ndata: ${JSON.stringify({ type: 'result', value: { prompt: 'Inspect input.ts and fix the crash. Run keyboard smoke.', summary: 'Read input.ts.', helper: { provider: 'codex', sessionId: 'helper', providerInstanceId: 'work' } } })}\n\n` }).catch(() => {})
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const composer = page.getByRole('textbox', { name: 'Composer', exact: true })
  await composer.fill('/better Fix the crash')
  await composer.press('Enter')
  await page.getByText('Reading your code and files', { exact: true }).waitFor()
  assert.equal(await composer.inputValue(), '')
  await composer.fill('New notes while researching')
  await page.waitForTimeout(30)
  assert.equal(pending, true)
  assert.equal(requests[0].providerInstanceId, 'work')
  assert.equal(requests[0].cwd, '/fixture/repo')
  assert.equal(requests[0].draft, 'Fix the crash')
  assert.equal(await page.locator('[data-better-live-rows] > div').count(), 2)
  const activeCell = page.locator('[aria-label="Stage 1 of 6"] > span').first()
  const opacity = await activeCell.evaluate(element => element.style.opacity)
  await page.waitForTimeout(550)
  assert.notEqual(await activeCell.evaluate(element => element.style.opacity), opacity)
  release()
  await page.getByText(/The improved prompt is in your input box/).waitFor()
  assert.equal(await composer.inputValue(), 'Inspect input.ts and fix the crash. Run keyboard smoke.\n\nNew notes while researching')
  const rewritten = await composer.inputValue()
  await page.getByRole('button', { name: 'Dismiss Better status', exact: true }).click()
  assert.equal(await page.locator('[data-better-live-rows]').count(), 0)
  assert.equal(await composer.inputValue(), rewritten)
  // Late replies cannot stage into another provider account.
  await composer.fill('/better Next request')
  await composer.press('Enter')
  await page.waitForTimeout(30)
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  release()
  await page.waitForTimeout(80)
  assert.equal(await composer.inputValue(), 'Personal draft')
  assert.equal(await page.getByText(/The improved prompt is in your input box/).count(), 0)
  await page.getByRole('button', { name: 'Disable better', exact: true }).click()
  assert.equal(await page.locator('[data-better-live-rows]').count(), 0)
  await page.getByRole('button', { name: 'Enable better', exact: true }).click()
  await page.getByRole('button', { name: 'Palette better', exact: true }).click()
  await page.getByRole('dialog', { name: 'Better prompt', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Web Better composer: PASS (real accessory host, slash dispatch, two live rows, background typing, automatic insertion, dismissal preserves draft and releases rows, account change, disable/re-enable; mocked provider endpoint)')
} finally {
  await browser?.close()
  await new Promise(resolve => server ? server.close(resolve) : resolve())
  await rm(directory, { recursive: true, force: true })
}
