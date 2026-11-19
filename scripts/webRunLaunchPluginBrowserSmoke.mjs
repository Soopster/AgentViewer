import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-run-launch-plugin-'))
let browser, server
let releasePending
const historyReads = []
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webRunLaunchPluginBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent', loader: { '.wasm': 'file' },
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
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const launches = [], pending = [], normalSends = []
  let failNext = false, delay = false
  const snapshot = (params, index) => ({ run: { id: `run-${index}`, prompt: params.prompt, status: 'running', provider: params.provider,
    baseCwd: params.baseCwd, maxAgents: params.maxAgents, autonomy: params.autonomy, acceptanceContract: params.acceptanceContract,
    requireReview: params.requireReview, requireReceipts: false, review: { status: 'not_required' }, phaseReports: [], learningCandidates: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, agents: [], tasks: [], events: [], messages: [], locks: [] })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname === '/api/agent-protocol/runs' && request.method() === 'POST') {
      const params = request.postDataJSON(), index = launches.length
      launches.push(params)
      const result = { snapshot: snapshot(params, index), sessions: [{ sessionId: `lead-${index}`, provider: params.provider,
        providerInstanceId: params.providerInstanceId, cwd: params.baseCwd, summary: 'Fixture lead', isPending: true }] }
      if (delay) await new Promise(resolve => pending.push(resolve))
      if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: 'Fixture launch refused' } }) }
      return route.fulfill({ json: result })
    }
    if (url.pathname.endsWith('/playbooks')) return route.fulfill({ json: { playbooks: [{ name: 'recipe', phaseCount: 1, taskCount: 1, path: 'recipe.json', expectsArgs: true, maxAgents: 4 }], invalid: [] } })
    if (request.method() === 'POST' && url.pathname.endsWith('/messages')) {
      normalSends.push(request.postDataJSON())
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"done"}\n\n' })
    }
    if (/\/api\/agent-protocol\/runs\/run-/.test(url.pathname)) return route.fulfill({ json: snapshot(launches.at(-1), launches.length - 1) })
    return route.fulfill({ json: { runs: [], tasks: [], events: [], models: [], tools: [], permissions: [], commands: [], subagents: [], messages: [] } })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' })
  const click = name => page.getByRole('button', { name, exact: true }).click()
  const brief = () => page.getByRole('textbox', { name: 'Outcome and acceptance criteria', exact: true })
  const launch = () => click('Launch workflow')
  const eventually = async predicate => { for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) } assert.ok(predicate()) }
  await brief().fill('Retain complete settings')
  await page.getByLabel('Agent limit', { exact: true }).fill('5')
  await page.getByLabel('Autonomy', { exact: true }).selectOption('high')
  await page.getByLabel('Token budget', { exact: false }).fill('12345')
  await page.getByLabel('Duration budget', { exact: false }).fill('30')
  await page.getByRole('textbox', { name: 'Completion gate optional', exact: true }).fill('npm test')
  await page.getByLabel('Acceptance checks', { exact: false }).fill('Visible result')
  await page.getByLabel('Non-goals', { exact: false }).fill('No unrelated edits')
  await page.getByLabel('Manual QA', { exact: false }).fill('Inspect output')
  await page.getByLabel('Escalation triggers', { exact: false }).fill('Breaking change')
  await click('Add codex from teammate provider pool')
  await page.getByRole('checkbox', { name: 'Review the lead plan before implementation', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Require judgment review after validation', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Use separate teammate checkouts', exact: true }).uncheck()
  await click('Move placement')
  assert.equal(await brief().inputValue(), 'Retain complete settings')
  assert.equal(await page.getByLabel('Agent limit', { exact: true }).inputValue(), '5')
  await launch()
  await page.getByRole('status').filter({ hasText: 'Workflow run-0 started' }).waitFor()
  assert.equal(launches[0].providerInstanceId, 'work')
  assert.equal(launches[0].model, 'model-work')
  assert.equal(launches[0].effort, 'high')
  assert.equal(launches[0].baseCwd, '/fixture/one')
  assert.equal(launches[0].maxAgents, 5)
  assert.equal(launches[0].autonomy, 'high')
  assert.equal(launches[0].requirePlanApproval, false)
  assert.equal(launches[0].requireReview, false)
  assert.equal(launches[0].useWorktrees, false)
  assert.deepEqual(launches[0].teammateProviders, ['claude', 'codex'])
  assert.deepEqual(launches[0].budget, { maxTokens: 12345, maxDurationMinutes: 30 })
  assert.deepEqual(launches[0].acceptanceContract.userVisibleAcceptance, ['Visible result'])
  assert.deepEqual(launches[0].acceptanceContract.nonGoals, ['No unrelated edits'])
  assert.deepEqual(launches[0].acceptanceContract.manualQa, ['Inspect output'])
  assert.deepEqual(launches[0].acceptanceContract.escalationTriggers, ['Breaking change'])
  failNext = true
  await brief().fill('Keep draft on failure')
  await launch()
  await page.getByRole('alert').filter({ hasText: 'Fixture launch refused' }).waitFor()
  assert.equal(await brief().inputValue(), 'Keep draft on failure')
  await page.getByLabel('Lead provider', { exact: true }).selectOption('codex')
  await launch()
  await page.getByRole('status').filter({ hasText: 'Workflow run-2 started' }).waitFor()
  assert.equal(launches[2].provider, 'codex')
  assert.equal(launches[2].providerInstanceId, undefined)
  assert.equal(launches[2].model, undefined)
  assert.equal(launches[2].effort, undefined)
  delay = true
  await brief().fill('Account switch during launch')
  await launch()
  await eventually(() => pending.length === 1)
  await brief().press('Control+Enter')
  assert.equal(launches.length, 4, 'pending invocation refuses duplicate launch')
  await click('Switch account')
  pending[0]()
  await page.waitForFunction(() => window.__runCompleted.length === 3)
  assert.equal(await page.evaluate(() => window.__runCompleted.at(-1).aborted), true)
  await brief().waitFor()
  assert.equal(await page.getByRole('status').filter({ hasText: 'Workflow run-3 started' }).count(), 0)
  await brief().fill('Disable pending launch')
  await launch()
  await eventually(() => pending.length === 2)
  await click('Disable coordination')
  pending[1]()
  await page.waitForFunction(() => window.__runCompleted.length === 4)
  assert.equal(await page.evaluate(() => window.__runCompleted.at(-1).aborted), true)
  await click('Enable coordination')
  await brief().waitFor()
  assert.equal(await page.getByRole('status').filter({ hasText: 'Workflow run-4 started' }).count(), 0)
  await brief().fill('Close pending launch')
  await launch()
  await eventually(() => pending.length === 3)
  await click('Hide launch')
  pending[2]()
  await page.waitForFunction(() => window.__runCompleted.length === 5)
  assert.equal(await page.evaluate(() => window.__runCompleted.at(-1).aborted), true)
  await click('Open launch')
  await brief().waitFor()
  assert.equal(await page.getByRole('status').filter({ hasText: 'Workflow run-5 started' }).count(), 0)
  delay = false
  await click('Use command host')
  await click('Dispatch start')
  await brief().fill('Captured command target')
  await click('Switch account')
  await click('Switch repository')
  await launch()
  await page.getByRole('status').filter({ hasText: 'Workflow run-6 started' }).waitFor()
  assert.equal(launches[6].providerInstanceId, 'personal')
  assert.equal(launches[6].baseCwd, '/fixture/one')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Start coordinated run', exact: true }).waitFor({ state: 'detached' })
  await click('Dispatch start')
  await brief().fill('New command target')
  await launch()
  await page.getByRole('status').filter({ hasText: 'Workflow run-7 started' }).waitFor()
  assert.equal(launches[7].providerInstanceId, 'work')
  assert.equal(launches[7].baseCwd, '/fixture/two')
  await page.keyboard.press('Escape')
  await click('Switch account')
  await click('Dispatch start')
  await brief().fill('Same repository new account')
  await launch()
  await page.getByRole('status').filter({ hasText: 'Workflow run-8 started' }).waitFor()
  assert.equal(launches[8].providerInstanceId, 'personal')
  assert.equal(launches[8].baseCwd, '/fixture/two')
  await page.keyboard.press('Escape')
  await click('Switch account')
  await click('Use embedded')
  await brief().fill('Embedded launch opens qualified lead')
  await launch()
  await page.waitForFunction(() => window.__runOpened.length === 1)
  assert.equal(await page.evaluate(() => window.__runOpened[0].providerInstanceId), 'work')
  await click('Use chat')
  const composer = page.getByRole('textbox', { name: 'Message', exact: true })
  await composer.fill('Ordinary send still uses session API')
  await composer.press('Enter')
  await eventually(() => normalSends.length === 1)
  assert.equal(normalSends[0].providerInstanceId, 'work')
  assert.equal(launches.length, 10)
  assert.deepEqual(errors, [])
  console.log('Web run launch: PASS (real form, HTTP adapter, placement defaults/options, provider account isolation, pending duplicate/close/disable/account races, repository command capture, qualified lead opening and normal MessageView send)')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
