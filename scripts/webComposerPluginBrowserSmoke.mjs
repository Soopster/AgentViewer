import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-composer-plugin-'))
let browser, server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webPluginCommandsBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent', loader: { '.wasm': 'file' },
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' },

  })
  const script = await readFile(bundle)
  const css = (await readFile('app/globals.css', 'utf8')).replace(/^@import[^;]+;/gm, '').replace(/@font-face\s*\{[^}]*\}/g, '')
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : `<!doctype html><html data-theme="dark"><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  const goals = new Map()
  const sends = []
  let releasePersonal
  let personalPending = false
  let goalReads = 0
  const mutations = []
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const body = request.method() === 'GET' ? null : request.postDataJSON()
    if (url.pathname.endsWith('/goal')) {
      const instance = body?.providerInstanceId ?? url.searchParams.get('providerInstanceId')
      if (request.method() === 'GET') { goalReads++; return route.fulfill({ json: { goal: goals.get(instance) ?? null } }) }
      mutations.push(request.method())
      if (request.method() === 'DELETE') { goals.delete(instance); return route.fulfill({ json: { ok: true } }) }
      const goal = { provider: 'codex', providerInstanceId: instance, sessionId: 'same', objective: body.objective, status: 'active', tokenBudget: null, tokensUsed: 0, continuations: 0, maxContinuations: 25, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastNote: null, lastDecision: null, lastEvaluatedAt: null, error: null, ...goals.get(instance), ...body }
      goals.set(instance, goal)
      if (request.method() === 'POST' && instance === 'personal') {
        personalPending = true
        await new Promise(resolve => { releasePersonal = resolve })
      }
      return route.fulfill({ json: { goal } }).catch(() => {})
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/messages')) {
      sends.push(body)
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"done"}\n\n' })
    }
    return route.fulfill({ json: { models: [], commands: [], permissions: [], subagents: [], sessions: [], tools: [] } })
  })
  page.on('console', event => { if (event.type() === 'error') console.error(event.text().slice(0, 800)) })
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await input.waitFor()
  await input.fill('Personal objective')
  await page.getByRole('button', { name: 'Open goal', exact: true }).click()
  const objective = page.getByPlaceholder('Ship the settings page: persisted theme, saved provider, and a green type-check.')
  await objective.waitFor()
  assert.equal(await objective.inputValue(), 'Personal objective')
  await page.getByRole('button', { name: 'START', exact: true }).click()
  await assertEventually(() => personalPending)
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.locator('[data-timeline-key]').getByText('Original work prompt', { exact: true }).waitFor()
  await input.fill('Work objective')
  releasePersonal()
  await page.waitForTimeout(200)
  assert.equal(sends.length, 0, 'a cancelled goal create cannot send to a different account')
  assert.equal(await input.textContent(), 'Work objective')
  await page.getByRole('button', { name: 'Open goal', exact: true }).click()
  await objective.waitFor()
  assert.equal(await objective.inputValue(), 'Work objective')
  await page.getByRole('button', { name: 'START', exact: true }).click()
  await assertEventually(() => sends.length === 1)
  assert.equal(sends[0].providerInstanceId, 'work')
  assert.equal(sends[0].message, 'Work objective')
  await page.getByRole('button', { name: 'Pause goal', exact: true }).click()
  await page.getByRole('button', { name: 'Resume goal', exact: true }).click()
  await page.getByRole('button', { name: 'Pause goal', exact: true }).waitFor()
  assert.equal(goals.get('work').status, 'active')
  const previousMutations = mutations.length
  await page.getByRole('button', { name: 'Disable goals', exact: true }).click()
  await page.getByRole('button', { name: 'Pause goal', exact: true }).waitFor({ state: 'detached' })
  const readsAfterDisable = goalReads
  await page.waitForTimeout(4300)
  assert.equal(goalReads, readsAfterDisable, 'disabled accessories stop polling')
  assert.equal(mutations.length, previousMutations, 'disabling presentation never stops the goal engine')
  await page.getByRole('button', { name: 'Enable goals', exact: true }).click()
  await page.getByRole('button', { name: 'Pause goal', exact: true }).waitFor()
  assert.equal(sends.length, 1, 'restoring the plugin never sends the objective again')
  await page.getByRole('button', { name: 'Clear goal', exact: true }).click()
  await assertEventually(() => !goals.has('work'))
  assert.deepEqual(errors, [])
  console.log('Web composer goal plugin: PASS (real MessageView, StrictMode, account cancellation, normal send, pause/resume, disable polling and independent engine lifetime)')

} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}

async function assertEventually(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(predicate(), 'condition did not settle')
}
