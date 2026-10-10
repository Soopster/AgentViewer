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
let observationFails = false
let executionElsewhere = false
let approvalId = 'approval-1'
let resultReady = false
let recoveryPending = false
let directoryAvailable = false
let conversationAvailable = true
let settled = false
let loseWorkflowResponse = true
const workflowEffects = new Set()
let recipe = { name: 'review-change', maxAgents: 3, requirePlanApproval: true, requireReview: true, phases: [
  { title: 'Implement', tasks: [{ key: 'build', title: 'Build {{args.feature}}', detail: 'Implement {{args.feature}}', paths: ['src/search.ts'], provider: 'codex' }] },
  { title: 'Review', tasks: [{ key: 'review', title: 'Review', detail: 'Check implementation', paths: [], provider: 'claude', dependsOn: ['build'] }] },
] }
let resources = { maxAgents: 4, occupiedAgents: 2, usage: {}, pausedReason: null }
const actions = []
const state = () => ({
  snapshot: enabled || stopped ? { run: { id: 'browser-run', status: stopped ? 'stopped' : 'running', leadAgentId: 'lead' },
    agents: [{ id: 'lead', role: 'lead', name: 'lead', ...lead, worktreePath: lead.cwd }, { ...worker, taskId: recoveryPending ? 'T2' : null, turnActive: !recoveryPending && !settled }],
    tasks: [...(recoveryPending ? [{ id: 'T2', title: 'Unfinished review', status: 'in_progress', ownerAgentId: worker.id, updatedAt: '2026-10-10T00:00:00Z' }] : []), ...(resultReady ? [{ id: 'T1', title: 'Review alpha', status: 'completed', ownerAgentId: worker.id, updatedAt: '2026-09-17T00:00:00Z', resultSummary: 'Alpha looks good' }] : [])], messages: [], events: [] } : null,
  interactive: { enabled, autoContinue, remainingTurns: 4, delivery: null, executionElsewhere, resources }, recoveries: recoveryPending ? [worker.id] : [], settledExecutions: settled ? [worker.id] : [], runningAgentIds: recoveryPending || settled ? [] : [worker.id],
  permissions: enabled && permissionPending ? [{ agentId: worker.id, agentName: worker.name, permission: { id: approvalId, sessionId: worker.sessionId, provider: 'codex', title: 'Review command needs approval' } }] : [],
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
    if (url.pathname === '/api/agent-protocol/attention') {
      // Herdr marks every pane in its sidebar; this is the session list's copy.
      data = { attention: enabled && permissionPending ? [{ sessionId: lead.sessionId, provider: 'codex', waiting: 1, finished: 0 }] : [] }
    }
    else if (url.pathname === '/api/agent-protocol/playbooks') {
      if (url.searchParams.get('preview') === 'interactive') {
        const args = JSON.parse(url.searchParams.get('args') || '{}')
        data = { playbook: recipe, args, maxAgents: 3, providers: ['codex', 'claude'], tasks: [
          { id: 'task-1', phase: 'Implement', title: `Build ${args.feature}`, prompt: `Implement ${args.feature}`, targetRole: 'teammate', seat: 'implementer', requestedProvider: 'codex', paths: ['src/search.ts'], blockedBy: [], verifyCommands: ['npm run check'] },
          { id: 'task-2', phase: 'Review', title: 'Review', prompt: 'Check implementation', targetRole: 'teammate', seat: 'validator', requestedProvider: 'claude', paths: [], blockedBy: ['task-1'], verifyCommands: [] },
        ] }
      } else data = { playbooks: [{ name: recipe.name, taskCount: 2, argsHint: '{"feature":"search"}' }] }
    }
    else if (url.pathname === '/api/provider') data = { provider: 'codex', providerInstanceId: 'codex', instances: [] }
    else if (url.pathname === '/api/sessions') data = { sessions: [lead] }
    else if (url.pathname.endsWith('/coordination/results/T1')) {
      if (route.request().method() === 'POST') { actions.push(route.request().postDataJSON()); data = { staged: true } }
      else data = { task: { ...state().snapshot.tasks[0], receipt: { recordedAt: '2026-09-29T00:00:00Z', filesChanged: ['alpha.ts'], commandsRun: ['npm run check'], verification: [{ command: 'npm run check', passed: true, exitCode: 0, summary: 'Types checked' }], needsDecision: [] } }, findings: [{ summary: 'Reviewed parser boundary', detail: 'No unchecked input remains.' }], runReview: { status: 'not_required' }, verification: 'current', integrationBlockers: [], checkout: { path: '/tmp/coord-browser/reviewer', branch: 'agent/reviewer', head: 'abc123', base: 'base123', target: '/tmp/coord-browser', files: ['alpha.ts', 'new.ts'], diff: '+validated(input)', diffTruncated: false, revision: 'a'.repeat(64), token: 'b'.repeat(64) } }
    }
    else if (url.pathname.endsWith('/coordination')) {
      if (observationFails && route.request().method() === 'GET') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture observation outage' }) })
        return
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); actions.push(body)
        if (body.action === 'enable') { enabled = true; stopped = false }
        if (body.action === 'disable') { enabled = false; autoContinue = false; stopped = true }
        if (body.action === 'settings') {
          if (body.autoContinue !== undefined) autoContinue = body.autoContinue
          if (body.maxAgents !== undefined) resources = { ...resources, maxAgents: body.maxAgents, budget: body.budget, pausedReason: null }
        }
        if (body.action === 'resume-agent') recoveryPending = false
        if (body.action === 'reconcile-agent') settled = false
        if (body.action === 'start-workflow') {
          workflowEffects.add(body.requestId)
          if (loseWorkflowResponse) { loseWorkflowResponse = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture lost workflow acknowledgement' }) }); return }
        }
      }
      data = url.searchParams.get('inspect') === 'recovery' ? { inspection: { runId: 'browser-run', evidence: [{ agentId: worker.id, sessionId: worker.sessionId, provider: worker.provider, worktreePath: worker.worktreePath, checkedAt: new Date().toISOString(), directory: { available: directoryAvailable, detail: directoryAvailable ? 'available' : 'saved directory missing' }, conversation: { available: conversationAvailable, detail: conversationAvailable ? 'native session available' : 'native session unavailable' } }] } } : state()
    } else if (url.pathname.endsWith('/messages')) {
      const sessionId = url.pathname.split('/')[3]
      data = { messages: transcript(sessionId), offset: 0, total: 1 }
    } else if (url.pathname.endsWith('/running')) {
      data = { running: url.pathname.includes(worker.sessionId), pendingPermissions: url.pathname.includes(worker.sessionId) && permissionPending ? [{ type: 'codex_approval', event: { type: 'approval.requested', requestId: approvalId, threadId: worker.sessionId, method: 'item/commandExecution/requestApproval', params: { command: 'cat alpha.txt', cwd: lead.cwd, reason: 'Read requested code' } } }] : [], pendingPrompts: [] }
    } else if (url.pathname.endsWith('/actions')) {
      actions.push(route.request().postDataJSON()); permissionPending = false
      data = { ok: true }
    } else if (url.pathname.endsWith('/models')) data = { models: [{ value: 'default', label: 'Default' }], currentModel: 'default' }
    else if (url.pathname === `/api/sessions/${lead.sessionId}`) data = { info: lead }
    else if (url.pathname === `/api/sessions/${worker.sessionId}`) data = { info: { ...lead, sessionId: worker.sessionId, summary: worker.name } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await context.grantPermissions(['notifications'], { origin })
  // Capture notifications and control focus: herdr's rule is that a user who is
  // looking at the team is not notified, so the page must be able to "blur".
  await context.addInitScript(() => {
    window.__notifications = []
    window.__blurred = false
    window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted') }
      constructor(title, options) { window.__notifications.push({ title, body: options?.body }) } }
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__blurred })
    document.hasFocus = () => !window.__blurred
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.locator(`[data-session-key="codex:${lead.sessionId}"]`).click({ timeout: 60000 })
  const dock = page.locator('.av-web-composer-card').first()
  const chatTab = dock.getByRole('tab', { name: 'Chat', exact: true })
  const teamTab = dock.getByRole('tab', { name: /^Teammates/ })
  await chatTab.click()
  const composer = dock.getByRole('textbox', { name: 'Message', exact: true }).filter({ visible: true }).first()
  await composer.fill('Preserve this lead draft while inspecting reviewer')
  await teamTab.click()
  await page.getByRole('button', { name: 'Enable coordinator', exact: true }).click()
  await page.getByText('Coordinator on', { exact: true }).waitFor()
  // The session list says which conversation needs you, without opening it.
  const sidebarBadge = page.locator('.av-session-row span', { hasText: /^! 1$/ }).first()
  await sidebarBadge.waitFor({ timeout: 15000 })
  assert.match(await sidebarBadge.getAttribute('title') ?? '', /need you/)
  await chatTab.click()
  await dock.getByLabel('1 need attention', { exact: true }).waitFor()
  await teamTab.click()
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
  assert.equal(await composer.innerText(), 'Preserve this lead draft while inspecting reviewer')
  await teamTab.click()
  await page.getByRole('button', { name: 'Follow up', exact: true }).click()
  assert.equal(await page.getByLabel('Send to', { exact: true }).inputValue(), worker.id)
  assert.match(await page.getByLabel('Task or follow-up', { exact: true }).inputValue(), /reviewer/)
  const roster = page.getByLabel('Persistent teammate conversations')
  await roster.getByText(/Working · live turn/).waitFor({ timeout: 15000 })
  const beforeFiltering = actions.length
  await roster.getByLabel('Find teammate').fill('codex reviewer')
  assert.equal(await roster.getByRole('button', { name: 'Transcript', exact: true }).count(), 1)
  await roster.getByLabel('Find teammate').fill('no-such-teammate')
  await roster.getByText('No teammates match these filters.').waitFor()
  assert.equal(await roster.getByRole('button', { name: 'Transcript', exact: true }).count(), 0, 'search hides unavailable destinations')
  await roster.getByRole('button', { name: 'Clear teammate filters' }).click()
  await roster.getByLabel('Teammate state').selectOption('working')
  assert.equal(await roster.getByRole('button', { name: 'Transcript', exact: true }).count(), 1)
  await roster.getByRole('button', { name: 'Clear teammate filters' }).click()
  assert.equal(actions.length, beforeFiltering, 'roster navigation sends no coordinator mutations')
  const actionCount = actions.length
  observationFails = true
  await roster.getByText(/Unknown · last observation unavailable/).waitFor({ timeout: 15000 })
  assert.equal(actions.length, actionCount, 'an observation outage must not submit work')
  observationFails = false
  await roster.getByText(/Working · live turn/).waitFor({ timeout: 15000 })
  executionElsewhere = true
  await roster.getByText(/Managed by another host/).waitFor({ timeout: 15000 })
  assert.equal(await page.getByRole('button', { name: 'Ask teammate', exact: true }).isDisabled(), true)
  executionElsewhere = false
  await roster.getByText(/Working · live turn/).waitFor({ timeout: 15000 })
  assert.deepEqual(await page.evaluate(() => window.__notifications), [], 'an approval held at first read, or raised while the user is looking, does not notify')
  await page.evaluate(() => { window.__blurred = true })
  // Herdr's delivery setting: off means off, even for a background team.
  await page.getByLabel('Teammate alerts', { exact: true }).selectOption('off')
  approvalId = 'approval-2'; permissionPending = true
  // Longer than the panel's 5s poll plus the notification delay, or this
  // assertion passes because nothing had arrived yet, whatever the setting.
  await page.waitForTimeout(9000)
  assert.deepEqual(await page.evaluate(() => window.__notifications), [], 'alerts set to off still notified')
  permissionPending = false
  await page.getByLabel('Teammate alerts', { exact: true }).selectOption('desktop')
  approvalId = 'approval-3'; permissionPending = true
  await page.waitForFunction(() => window.__notifications.length > 0, null, { timeout: 15000 })
  const [notification] = await page.evaluate(() => window.__notifications)
  assert.match(notification.title, /reviewer is waiting for your answer/)
  await page.evaluate(() => { window.__blurred = false })
  permissionPending = false
  // Herdr marks a completion seen when its agent is focused: reading the
  // teammate's transcript reviews its result without a separate click.
  resultReady = true
  await page.getByRole('button', { name: 'Mark reviewed', exact: true }).waitFor({ timeout: 15000 })
  const resultCard = panel.getByRole('article', { name: 'result', exact: true })
  await resultCard.getByRole('button', { name: 'Review result', exact: true }).click()
  await resultCard.getByText(/Verification: current/).waitFor()
  await resultCard.getByText('Reviewed parser boundary', { exact: false }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).count(), 1, 'inspection alone must not mark reviewed')
  await page.screenshot({ path: '/tmp/coordinator-result-review.png', fullPage: true })
  await resultCard.getByRole('button', { name: 'Stage changes in target checkout…', exact: true }).click()
  assert.equal(actions.filter(action => action.token).length, 0, 'integration waits for confirmation')
  await resultCard.getByRole('button', { name: 'Confirm stage changes', exact: true }).click()
  await resultCard.getByText(/Changes staged in the target checkout/).waitFor()
  assert.ok(actions.some(action => action.token === 'b'.repeat(64) && action.requestId))
  await roster.getByRole('button', { name: 'Transcript', exact: true }).click()
  await page.getByRole('button', { name: 'Close teammate', exact: true }).click()
  await teamTab.click()
  await roster.getByText(/reviewer ·/).waitFor({ timeout: 15000 })
  assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).count(), 0, 'opening the transcript did not review its result')
  await page.screenshot({ path: '/tmp/coordinator-docked-teammates.png', fullPage: true })
  await chatTab.click()
  assert.equal(await composer.innerText(), 'Preserve this lead draft while inspecting reviewer')
  await page.screenshot({ path: '/tmp/coordinator-docked-chat.png', fullPage: true })
  await teamTab.click()
  await page.getByRole('button', { name: 'Turn off', exact: true }).click()
  await dock.locator('[role=tab][data-state=active]').filter({ hasText: /^Chat$/ }).waitFor()
  await teamTab.click()
  await page.getByText('Coordinator off', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Task or follow-up', { exact: true }).count(), 0)
  assert.ok(actions.some(action => action.action === 'disable' && action.requestId))
  await page.getByRole('button', { name: 'Enable coordinator', exact: true }).click()
  await page.getByText('Coordinator on', { exact: true }).waitFor()
  // Web controls complete the same recipe/resource/recovery flows as the TUI.
  await panel.locator('summary').filter({ hasText: /^Team resources/ }).click()
  await panel.getByText(/Reported tokens: unavailable/).waitFor()
  await panel.getByLabel('Agent capacity (includes lead)', { exact: true }).fill('1')
  const beforeLimits = actions.length
  await panel.getByRole('button', { name: 'Apply team limits', exact: true }).click()
  await panel.getByRole('alert').filter({ hasText: /Capacity must be between/ }).waitFor()
  assert.equal(actions.length, beforeLimits, 'invalid limits never submit')
  await panel.getByLabel('Agent capacity (includes lead)', { exact: true }).fill('6')
  await panel.getByLabel('Run token limit', { exact: true }).fill('20000')
  await panel.getByRole('button', { name: 'Apply team limits', exact: true }).click()
  await panel.getByText(/Capacity: 2\/6 agents/).waitFor()
  const limits = actions.findLast(action => action.maxAgents === 6)
  assert.deepEqual(limits.budget, { maxTokens: 20000 })
  assert.equal(limits.expectedRunId, 'browser-run')

  await panel.locator('summary').filter({ hasText: 'Start a saved team workflow' }).click()
  await panel.getByLabel('Arguments (text or JSON)', { exact: true }).fill('{broken')
  await panel.getByRole('button', { name: 'Preview workflow', exact: true }).click()
  await panel.getByRole('alert').filter({ hasText: /SyntaxError/ }).waitFor()
  assert.equal(await panel.getByRole('button', { name: 'Start this team in chat', exact: true }).count(), 0)
  await panel.getByLabel('Arguments (text or JSON)', { exact: true }).fill('{"feature":"search"}')
  await panel.getByRole('button', { name: 'Preview workflow', exact: true }).click()
  await panel.locator('pre').filter({ hasText: 'Build search' }).waitFor()
  assert.match(await panel.locator('pre').filter({ hasText: 'Build search' }).innerText(), /Depends on: task-1/)
  const frozenRecipe = structuredClone(recipe)
  recipe = { ...recipe, phases: [{ title: 'Changed after preview', tasks: [{ title: 'Unexpected', detail: 'Unexpected' }] }] }
  await panel.getByRole('button', { name: 'Start this team in chat', exact: true }).click()
  await panel.getByRole('button', { name: 'Retry same request', exact: true }).waitFor()
  const firstStart = actions.findLast(action => action.action === 'start-workflow')
  assert.deepEqual(firstStart.playbook, frozenRecipe)
  assert.deepEqual(firstStart.workflowArgs, { feature: 'search' })
  assert.equal(firstStart.expectedRunId, 'browser-run')
  assert.equal(await panel.getByRole('button', { name: 'Start this team in chat', exact: true }).isDisabled(), true)
  await panel.getByRole('button', { name: 'Retry same request', exact: true }).click()
  await panel.getByRole('button', { name: 'Retry same request', exact: true }).waitFor({ state: 'hidden' })
  assert.deepEqual(actions.findLast(action => action.action === 'start-workflow'), firstStart)
  assert.equal(workflowEffects.size, 1)

  permissionPending = false; recoveryPending = true
  await panel.getByText('reviewer: execution needs reconciliation', { exact: true }).waitFor({ timeout: 15000 })
  const recovery = panel.getByRole('button', { name: /^Team recovery overview/ }).locator('..')
  const beforeInspect = actions.length
  await recovery.getByRole('button', { name: /^Team recovery overview/ }).click()
  await recovery.getByText(/saved directory missing/).waitFor()
  assert.equal(actions.length, beforeInspect, 'availability inspection does not resume')
  assert.equal(await recovery.getByRole('button', { name: 'Resume after inspection', exact: true }).count(), 0)
  directoryAvailable = true; conversationAvailable = false
  await recovery.getByRole('button', { name: 'Refresh availability', exact: true }).click()
  await recovery.getByText(/native session unavailable/).waitFor()
  assert.equal(await recovery.getByRole('button', { name: 'Resume after inspection', exact: true }).count(), 0)
  conversationAvailable = true
  await recovery.getByRole('button', { name: 'Refresh availability', exact: true }).click()
  await recovery.getByRole('button', { name: 'Resume after inspection', exact: true }).click()
  assert.equal(actions.length, beforeInspect, 'first recovery click only opens confirmation')
  await recovery.getByRole('button', { name: 'Keep paused', exact: true }).click()
  assert.equal(actions.length, beforeInspect)
  await recovery.getByRole('button', { name: 'Resume after inspection', exact: true }).click()
  await recovery.getByRole('button', { name: 'Confirm resume', exact: true }).click()
  await recovery.getByRole('button', { name: 'Confirm resume', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(actions.filter(action => action.action === 'resume-agent').length, 1)
  assert.equal(actions.findLast(action => action.action === 'resume-agent')?.to, worker.id)
  settled = true
  await recovery.getByRole('button', { name: 'Acknowledge inspected result', exact: true }).waitFor({ timeout: 15000 })
  await recovery.getByRole('button', { name: 'Acknowledge inspected result', exact: true }).click()
  assert.equal(actions.filter(action => action.action === 'reconcile-agent').length, 0)
  await recovery.getByRole('button', { name: 'Confirm acknowledgement; no new turn', exact: true }).click()
  await recovery.getByRole('button', { name: 'Confirm acknowledgement; no new turn', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(actions.filter(action => action.action === 'reconcile-agent').length, 1)
  await page.screenshot({ path: '/tmp/coordinator-workflow-recovery.png', fullPage: true })
  await chatTab.click()
  assert.equal(await composer.innerText(), 'Preserve this lead draft while inspecting reviewer')
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('Rendered enablement, continuation preference, native attention, embedded transcript, lead draft preservation, named follow-up, outage recovery, foreign-host activity, blurred-only teammate notifications honouring the delivery setting, review on transcript open, sidebar teammate marks, workflow preview/frozen retry, resource validation/missing usage, and unavailable/explicit recovery/terminal acknowledgement passed')
} finally { await browser.close() }
