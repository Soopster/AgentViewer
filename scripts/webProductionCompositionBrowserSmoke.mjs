import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { chromium } from 'playwright-core'

// Requires npm run build. Exercise the actual Next.js routes and application
// composition while intercepting every API call before it reaches a provider.
const reservation = createServer()
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve) })
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', data => { serverLog = (serverLog + data).slice(-8000) })
server.stderr.on('data', data => { serverLog = (serverLog + data).slice(-8000) })
let browser
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clearInterval(poll); reject(new Error(`Next server startup timed out: ${serverLog}`)) }, 30000)
    const poll = setInterval(() => {
      if (server.exitCode !== null) { clearTimeout(timer); clearInterval(poll); reject(new Error(serverLog)); return }
      if (!serverLog.includes('Ready in')) return
      clearTimeout(timer); clearInterval(poll); resolve()
    }, 50)
  })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.setDefaultTimeout(15000)
  const errors = []
  const messageReads = []
  const fileReads = []
  let acceptCreationRoute
  const creationRoute = new Promise(resolve => { acceptCreationRoute = resolve })
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack) })
  const sessions = [{ sessionId: 'alpha', provider: 'claude', providerInstanceId: 'claude', summary: 'Alpha production fixture',
    firstPrompt: 'Alpha fixture', cwd: '/fixture/alpha', lastModified: Date.now() },
  { sessionId: 'beta', provider: 'codex', providerInstanceId: 'codex', summary: 'Beta production fixture', cwd: '/fixture/beta', lastModified: Date.now() }]
  const destinations = sessions.map(session => ({ sessionId: session.sessionId, provider: session.provider,
    name: `${session.sessionId}-name`, title: session.summary, running: false }))
  const transcript = [
    { type: 'user', uuid: 'user', session_id: 'alpha', parent_tool_use_id: null, provider: 'claude',
      message: { role: 'user', content: [{ type: 'text', text: 'Production fixture prompt' }] } },
    { type: 'assistant', uuid: 'assistant', session_id: 'alpha', parent_tool_use_id: null, provider: 'claude',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Production fixture response' }] } },
  ]
  await page.route('**/api/**', route => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname
    if (pathname === '/api/provider') return route.fulfill({ json: request.method() === 'PATCH'
      ? { ok: true, ...request.postDataJSON() }
      : { provider: 'claude', providerInstanceId: 'claude', instances: ['claude', 'codex'].map(provider => ({
        id: provider, provider, displayName: provider, enabled: true, isDefault: true, configured: true,
      })) } })
    if (pathname === '/api/sessions') return route.fulfill({ json: { sessions: url.searchParams.get('provider') === 'all'
      ? sessions : sessions.filter(session => session.provider === url.searchParams.get('provider')) } })
    if (pathname === '/api/sessions/new') { acceptCreationRoute(route); return }
    if (pathname === '/api/agents') return route.fulfill({ json: { sessions: destinations } })
    if (pathname === '/api/agents/message') return route.fulfill({ json: { delivered: true, mode: 'queued', targetName: 'Alpha production fixture' } })
    if (pathname.endsWith('/messages/events')) return route.fulfill({ status: 204, body: '' })
    if (pathname.endsWith('/messages')) {
      messageReads.push(pathname.split('/')[3])
      const messages = pathname.includes('/beta/') ? transcript.map(message => ({ ...message, session_id: 'beta', provider: 'codex',
        message: { ...message.message, content: [{ type: 'text', text: message.type === 'user' ? 'Beta fixture prompt' : 'Beta fixture response' }] },
      })) : transcript
      return route.fulfill({ json: { messages, offset: 0, total: messages.length } })
    }
    if (pathname === '/api/files') {
      if (url.searchParams.has('cwd')) return route.fulfill({ json: { files: [], total: 0 } })
      fileReads.push(Object.fromEntries(url.searchParams))
      return route.fulfill({ json: { kind: 'directory', path: url.searchParams.get('path'), parent: '/fixture', entries: [], parentEntries: [], truncated: false } })
    }
    if (pathname === '/api/bridge-messages') return route.fulfill({ json: { messages: [] } })
    if (pathname === '/api/agent-protocol/attention') return route.fulfill({ json: { attention: [] } })
    return route.fulfill({ json: { sessions: [], models: [], commands: [], permissions: [], subagents: [], tools: [], activities: [] } })
  })
  const base = `http://127.0.0.1:${port}`
  await page.goto(`${base}/agents?to=beta-name`)
  const beta = page.locator('.av-messaging-session').filter({ hasText: 'Beta production fixture' })
  await beta.waitFor()
  assert.equal(await beta.getAttribute('aria-pressed'), 'true', 'server route passes the requested recipient into the client feature')
  assert.equal(await page.getByRole('main').count(), 1)
  await page.getByRole('link', { name: 'Back to Sessions' }).waitFor()
  await page.goto(`${base}/?to=beta-name`)
  const alphaRow = page.locator('[data-session-key="claude:alpha"]')
  await alphaRow.waitFor()
  await page.getByRole('button', { name: 'Open cross-session messaging', exact: true }).click()
  await page.getByRole('heading', { name: 'Cross-Session Messaging', exact: true }).waitFor()
  const alpha = page.locator('.av-messaging-session').filter({ hasText: 'Alpha production fixture' })
  await alpha.waitFor()
  assert.equal(await alpha.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('link', { name: 'Back to Sessions' }).count(), 0)
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Production composition check')
  await page.getByRole('button', { name: 'Send Message', exact: true }).click()
  await page.getByText('Started a new turn for Alpha production fixture.', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('to'), 'beta-name')
  await page.getByRole('tab', { name: 'Session Runs', exact: true }).click()
  await page.getByRole('heading', { name: 'Run Dashboard', exact: true }).waitFor()
  await alphaRow.click()
  await page.getByText('Production fixture prompt', { exact: true }).waitFor()
  await page.getByText('Production fixture response', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Show right panel', exact: true }).click()
  const panel = page.locator('[data-right-panel]')
  await panel.getByRole('button', { name: 'Open a surface', exact: true }).click()
  const alphaFiles = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/files' && url.searchParams.get('path') === '/fixture/alpha'
  })
  await panel.getByRole('button', { name: 'Files F', exact: true }).click()
  await alphaFiles
  await panel.getByRole('navigation', { name: 'File path' }).getByTitle('Open /fixture/alpha', { exact: true }).waitFor()
  assert.ok(fileReads.some(read => read.path === '/fixture/alpha' && read.sessionId === 'alpha' && read.provider === 'claude'))
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('all')
  const betaFiles = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/files' && url.searchParams.get('path') === '/fixture/beta'
  })
  await page.locator('[data-session-key="codex:beta"]').click()
  await betaFiles
  await page.getByText('Beta fixture response', { exact: true }).waitFor()
  await panel.getByRole('navigation', { name: 'File path' }).getByTitle('Open /fixture/beta', { exact: true }).waitFor()
  assert.ok(fileReads.some(read => read.path === '/fixture/beta' && read.sessionId === 'beta' && read.provider === 'codex'))
  await panel.getByRole('button', { name: 'Hide panel', exact: true }).click()
  await panel.waitFor({ state: 'detached' })
  await page.locator('.av-session-tab.av-active').getByRole('button', { name: 'Close tab', exact: true }).click()
  await page.getByText('Production fixture response', { exact: true }).waitFor()
  assert.ok((await page.locator('.av-session-tab.av-active').getAttribute('title')).includes('Alpha'))
  await page.locator('.av-session-tab.av-active').getByRole('button', { name: 'Close tab', exact: true }).click()
  await page.getByText('Production fixture response', { exact: true }).waitFor({ state: 'detached' })
  assert.equal(await page.locator('.av-session-tab').count(), 0)
  await page.getByRole('button', { name: 'Start a new agent session', exact: true }).click()
  const creation = await creationRoute
  assert.equal(creation.request().postDataJSON().provider, 'claude')
  await alphaRow.click()
  await page.getByText('Production fixture response', { exact: true }).waitFor()
  await creation.fulfill({ json: { sessionId: 'late-created', provider: 'claude', providerInstanceId: 'claude', isPending: true } })
  const pendingTab = page.locator('.av-session-tab').filter({ hasText: 'New session' })
  await pendingTab.waitFor()
  assert.ok((await page.locator('.av-session-tab.av-active').getAttribute('title')).includes('Alpha'))
  await pendingTab.click()
  await page.locator('.av-session-tab.av-active').filter({ hasText: 'New session' }).waitFor()
  await page.getByText('Production fixture response', { exact: true }).waitFor({ state: 'detached' })
  assert.ok((await page.locator('.av-session-tab.av-active').getAttribute('title')).includes('New session'))
  await page.waitForTimeout(2200) // Observe one active-transcript poll interval.
  assert.equal(messageReads.includes('late-created'), false, 'a newly created pending tab must not read an unavailable transcript')
  assert.deepEqual(errors, [])
  console.log('Web production composition browser: standalone route, embedded messaging, dashboard navigation, current panel repository services, transcript selection, adjacent-tab fallback, final-tab cleanup, and background pending-session creation passed with mocked APIs')
} finally {
  await browser?.close()
  if (server.exitCode === null) {
    const stopped = once(server, 'exit')
    server.kill('SIGTERM')
    await stopped
  }
}
