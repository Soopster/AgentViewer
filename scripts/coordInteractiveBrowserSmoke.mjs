import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const origin = process.env.COORD_SMOKE_ORIGIN ?? 'http://127.0.0.1:3210'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
const lead = { sessionId: 'coord-primary', provider: 'codex', summary: 'Coordinator browser fixture', cwd: '/tmp/coord-browser', lastModified: Date.now(), createdAt: Date.now() }
const worker = { id: 'agent-1', name: 'reviewer', role: 'teammate', sessionId: 'coord-reviewer', provider: 'codex', worktreePath: lead.cwd, status: 'working', turnActive: true, liveness: { status: 'fresh', ageSeconds: 0 } }
let enabled = false
let stopped = false
let autoContinue = false
let permissionPending = true
const actions = []
const state = () => ({
  snapshot: enabled || stopped ? { run: { id: 'browser-run', status: stopped ? 'stopped' : 'running', leadAgentId: 'lead' },
    agents: [{ id: 'lead', role: 'lead', name: 'lead', ...lead }, worker], tasks: [], messages: [], events: [] } : null,
  interactive: { enabled, autoContinue, remainingTurns: 4, delivery: null }, recoveries: [], runningAgentIds: [worker.id],
  permissions: enabled && permissionPending ? [{ agentId: worker.id, agentName: worker.name, permission: { id: 'approval-1', sessionId: worker.sessionId, provider: 'codex', title: 'Review command needs approval' } }] : [],
})
const transcript = sessionId => [{ type: 'assistant', uuid: `${sessionId}-message`, session_id: sessionId, parent_tool_use_id: null, provider: 'codex',
  message: { role: 'assistant', content: [{ type: 'text', text: sessionId === worker.sessionId ? 'Reviewer transcript: inspected the requested files.' : 'Lead transcript: ready to coordinate.' }] } }]
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    let data = {}
    if (url.pathname === '/api/provider') data = { provider: 'codex', providerInstanceId: 'codex', instances: [] }
    else if (url.pathname === '/api/sessions') data = { sessions: [lead] }
    else if (url.pathname.endsWith('/coordination')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); actions.push(body)
        if (body.action === 'enable') enabled = true
        if (body.action === 'disable') { enabled = false; autoContinue = false; stopped = true }
        if (body.action === 'settings') autoContinue = body.autoContinue
      }
      data = state()
    } else if (url.pathname.endsWith('/messages')) {
      const sessionId = url.pathname.split('/')[3]
      data = { messages: transcript(sessionId), offset: 0, total: 1 }
    } else if (url.pathname.endsWith('/running')) {
      data = { running: url.pathname.includes(worker.sessionId), pendingPermissions: url.pathname.includes(worker.sessionId) && permissionPending ? [{ type: 'codex_approval', event: { type: 'approval.requested', requestId: 'approval-1', threadId: worker.sessionId, method: 'item/commandExecution/requestApproval', params: { command: 'cat alpha.txt', cwd: lead.cwd, reason: 'Read requested code' } } }] : [], pendingPrompts: [] }
    } else if (url.pathname.endsWith('/actions')) {
      actions.push(route.request().postDataJSON()); permissionPending = false
      data = { ok: true }
    } else if (url.pathname.endsWith('/models')) data = { models: [{ value: 'default', label: 'Default' }], currentModel: 'default' }
    else if (url.pathname === `/api/sessions/${lead.sessionId}`) data = { info: lead }
    else if (url.pathname === `/api/sessions/${worker.sessionId}`) data = { info: { ...lead, sessionId: worker.sessionId, summary: worker.name } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.locator(`[data-session-key="codex:${lead.sessionId}"]`).click({ timeout: 60000 })
  const dock = page.locator('.av-web-composer-card').first()
  const chatTab = dock.getByRole('tab', { name: 'Chat', exact: true })
  const teamTab = dock.getByRole('tab', { name: 'Teammates', exact: true })
  await chatTab.click()
  const composer = dock.locator('textarea').filter({ visible: true }).first()
  await composer.fill('Preserve this lead draft while inspecting reviewer')
  await teamTab.click()
  await page.getByRole('button', { name: 'Enable coordinator', exact: true }).click()
  await page.getByText('Coordinator on', { exact: true }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Conversation teammates' }).count(), 0, 'teammates is docked, not floating')
  const panel = page.getByRole('region', { name: 'Conversation teammates' })
  const cardBounds = await dock.boundingBox()
  const panelBounds = await panel.boundingBox()
  assert.ok(panelBounds.x >= cardBounds.x && panelBounds.y >= cardBounds.y)
  assert.ok(panelBounds.y + panelBounds.height <= cardBounds.y + cardBounds.height + 1)
  await page.getByLabel('Continue when teammates respond').check()
  assert.ok(actions.some(action => action.action === 'settings' && action.autoContinue === true))
  await page.getByRole('button', { name: 'Inspect and answer', exact: true }).click()
  const inspector = page.getByRole('region', { name: 'reviewer conversation', exact: true })
  await inspector.getByText('Reviewer transcript: inspected the requested files.').first().waitFor({ timeout: 60000 })
  await inspector.getByRole('button', { name: 'Allow', exact: true }).click()
  assert.equal(permissionPending, false)
  await page.getByRole('button', { name: 'Close teammate', exact: true }).click()
  assert.equal(await composer.inputValue(), 'Preserve this lead draft while inspecting reviewer')
  await teamTab.click()
  await page.getByRole('button', { name: 'Follow up', exact: true }).click()
  assert.equal(await page.getByLabel('Send to', { exact: true }).inputValue(), worker.id)
  assert.match(await page.getByLabel('Task or follow-up', { exact: true }).inputValue(), /reviewer/)
  await page.screenshot({ path: '/tmp/coordinator-docked-teammates.png', fullPage: true })
  await chatTab.click()
  assert.equal(await composer.inputValue(), 'Preserve this lead draft while inspecting reviewer')
  await page.screenshot({ path: '/tmp/coordinator-docked-chat.png', fullPage: true })
  await teamTab.click()
  await page.getByRole('button', { name: 'Turn off', exact: true }).click()
  await dock.locator('[role=tab][data-state=active]').filter({ hasText: /^Chat$/ }).waitFor()
  await teamTab.click()
  await page.getByText('Coordinator off', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Task or follow-up', { exact: true }).count(), 0)
  assert.ok(actions.some(action => action.action === 'disable' && action.requestId))
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('Rendered enablement, continuation preference, native attention, embedded transcript, lead draft preservation, and named follow-up passed')
} finally { await browser.close() }
