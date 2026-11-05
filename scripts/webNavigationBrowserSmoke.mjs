import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-navigation-'))
let browser
let server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webNavigationBrowserFixture.tsx'], bundle: true,
    platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent' })
  const script = await readFile(bundle)
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : '<!doctype html><style>[data-slot=sidebar-rail]{position:absolute;right:0;top:0;bottom:0;width:12px;z-index:10}</style><div id="root"></div><script src="/fixture.js"></script>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
  page.setDefaultTimeout(10000)
  const errors = []
  const searches = []
  const edits = []
  let failedUnpin = false
  page.on('pageerror', error => errors.push(String(error)))
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/sessions/alpha' && route.request().method() === 'PATCH') {
      edits.push(route.request().postDataJSON())
      return route.fulfill({ json: {} })
    }
    if (url.pathname.endsWith('/inbox')) {
      const { action } = route.request().postDataJSON()
      if (action === 'unpin') {
        failedUnpin = true
        return route.fulfill({ status: 500, json: { error: 'Fixture failure' } })
      }
      return route.fulfill({ json: { inbox: { pinnedAt: 1000, pinOrder: 1000 } } })
    }
    if (url.pathname.endsWith('/subagents')) return route.fulfill({ json: { subagents: [] } })
    if (url.pathname === '/api/session-index/rebuild') return route.fulfill({ json: { sessions: 2, messages: 4, errors: [] } })
    if (url.pathname === '/api/session-index/search') {
      const query = url.searchParams.get('q')
      searches.push(Object.fromEntries(url.searchParams))
      if (query === 'older') await new Promise(resolve => setTimeout(resolve, 350))
      const results = query === 'needle' || query === 'older' ? [{
        session: { key: 'claude:indexed', sessionId: 'indexed', provider: 'claude', title: 'Indexed fixture', cwd: '/fixture/alpha' },
        score: 100,
        matches: [{ messageKey: 'match', uuid: 'target-message', type: 'assistant', timestampMs: null,
          snippet: query === 'older' ? 'Stale response' : 'needle match', score: 100, toolNames: [] }],
      }] : []
      // The old query may have been aborted while its response was delayed.
      return route.fulfill({ json: { query, total: results.length, results } }).catch(() => {})
    }
    return route.fulfill({ status: 404, json: { error: 'No fixture response' } })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const alpha = page.locator('[data-session-key="claude:alpha"]')
  const beta = page.locator('[data-session-key="claude:beta"]')
  await alpha.waitFor()
  const search = page.getByPlaceholder('Search title, tags, path, prompt…')
  await search.fill('Beta')
  await alpha.waitFor({ state: 'detached' })
  await beta.waitFor()
  await search.fill('')
  await alpha.waitFor()
  await alpha.getByTitle('Double-click to rename title').dblclick()
  await alpha.locator('input').fill('Renamed alpha')
  await alpha.locator('input').press('Enter')
  await alpha.getByText('Renamed alpha', { exact: true }).waitFor()
  await alpha.getByTitle('Double-click to edit tags').dblclick()
  await alpha.getByPlaceholder('tag1, tag2').fill('review, checked')
  await alpha.getByPlaceholder('tag1, tag2').press('Enter')
  await alpha.getByText('#checked', { exact: true }).waitFor()
  const other = page.locator('[data-session-key="claude-other:alpha"]')
  await other.getByText('Other alpha instance', { exact: true }).waitFor()
  assert.equal(await other.getByText('#checked', { exact: true }).count(), 0)
  await other.getByTitle('Double-click to rename title').dblclick()
  await other.locator('input').fill('Other renamed')
  await other.locator('input').press('Enter')
  await other.getByText('Other renamed', { exact: true }).waitFor()
  await alpha.getByText('Renamed alpha', { exact: true }).waitFor()
  await other.getByTitle('Double-click to edit tags').dblclick()
  await other.getByPlaceholder('tag1, tag2').fill('personal, isolated')
  await other.getByPlaceholder('tag1, tag2').press('Enter')
  await other.getByText('#isolated', { exact: true }).waitFor()
  assert.equal(await alpha.getByText('#isolated', { exact: true }).count(), 0)
  await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="events"]').textContent).some(event => event.startsWith('tag:alpha:') && event.includes('isolated')))
  assert.ok(edits.some(edit => edit.title === 'Other renamed' && edit.providerInstanceId === 'claude-other'))
  assert.ok(edits.some(edit => edit.tag === 'mv-tags:["personal","isolated"]' && edit.providerInstanceId === 'claude-other'))
  await alpha.hover()
  await alpha.getByTitle('Pin', { exact: true }).click()
  await alpha.getByTitle('Unpin', { exact: true }).waitFor()
  const unpinResponse = page.waitForResponse(response => response.url().endsWith('/inbox') && response.status() === 500)
  await alpha.getByTitle('Unpin', { exact: true }).click()
  await unpinResponse
  await alpha.getByTitle('Unpin', { exact: true }).waitFor()
  assert.ok(failedUnpin, 'failed inbox action rolls back optimistic state')
  const rail = page.getByTitle('Drag to resize · double-click to reset')
  await rail.dispatchEvent('mousedown', { clientX: 300 })
  await page.mouse.move(500, 300)
  await page.mouse.up()
  await page.waitForFunction(() => localStorage.getItem('agentViewer:sidebarWidth') === '500')
  await rail.dblclick()
  await page.waitForFunction(() => localStorage.getItem('agentViewer:sidebarWidth') === '290')
  await page.getByTestId('palette').click()
  const query = page.getByPlaceholder('Search messages, sessions, projects, commands, or providers...')
  await query.fill('older')
  await page.waitForRequest(request => new URL(request.url()).searchParams.get('q') === 'older')
  await query.fill('needle')
  const match = page.getByText('needle match', { exact: true })
  await match.waitFor()
  await page.waitForTimeout(400)
  assert.equal(await page.getByText('Stale response', { exact: true }).count(), 0)
  assert.ok(searches.some(request => request.q === 'needle' && request.dir === '/fixture/alpha'
    && request.messagesOnly === '1' && request.includeWorktrees === 'true'))
  await match.click()
  await page.waitForFunction(() => document.querySelector('[data-testid="events"]').textContent.includes('message:indexed:target-message'))
  await page.getByTestId('palette').click()
  await query.fill('rebuild')
  await page.getByText('Rebuild search index', { exact: true }).click()
  await page.getByText('2 sessions · 4 messages', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.deepEqual(errors, [])
  console.log('Web navigation browser smoke passed: filtering, rename/tags, inbox rollback, resize, scoped search, cancellation, target selection, and rebuild')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
