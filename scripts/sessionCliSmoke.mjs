// Pins `agent-viewer session <verb>` against a fake daemon: state classification,
// the wait loop and its exit code, prompt's wire shape, and the launcher's verb list.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

const { runSessionCli, SESSION_CLI_VERBS, classifySessionState, parseSessionCliArgs } = await import('../bin/agent-viewer-session-cli.mjs')

// Launcher mirrors the verb list.
const launcher = readFileSync(new URL('../bin/agent-viewer.mjs', import.meta.url), 'utf8')
const mirrored = /const SESSION_CLI_VERBS = (\[[^\]]*\])/.exec(launcher)?.[1]
assert.deepEqual(JSON.parse(mirrored.replaceAll("'", '"')), SESSION_CLI_VERBS, 'launcher verb list drifted')

// State classification.
assert.equal(classifySessionState({ running: false }).state, 'idle')
assert.equal(classifySessionState({ running: true }).state, 'working')
assert.deepEqual(classifySessionState({ running: true, pendingPermissions: [{}], pendingPrompts: [{}] }), { state: 'blocked', waitingOn: ['permission', 'question'] })
assert.deepEqual(parseSessionCliArgs(['prompt', 's1', 'hi', '--wait', '--timeout', '5']), { positionals: ['prompt', 's1', 'hi'], flags: { wait: true, timeout: '5' } })

let runningPolls = 0
let reportedBody = null
let reportsFor = {}
let sent = null
let interrupted = false
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (req.url.startsWith('/api/sessions/reports') && req.method === 'POST') { reportedBody = JSON.parse(raw); return json(200, { ok: true, stale: false }) }
    if (req.url.startsWith('/api/sessions/reports')) { const id = new URL(req.url, 'http://x').searchParams.get('sessionId'); return json(200, { reports: reportsFor[id] ?? [] }) }
    if (req.url.startsWith('/api/sessions/s1/running')) { runningPolls += 1; return json(200, { running: runningPolls < 3, provider: 'claude', pendingPermissions: [], pendingPrompts: [] }) }
    if (req.url.startsWith('/api/sessions/idle/running')) return json(200, { running: false })
    if (req.url.startsWith('/api/sessions/s1/messages') && req.method === 'POST') { sent = JSON.parse(raw); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {}\n\n'); setTimeout(() => res.end(), 30); return }
    if (req.url.startsWith('/api/sessions/s1/messages')) return json(200, { messages: [{ uuid: 'm1' }], url: req.url })
    if (req.url.startsWith('/api/sessions/s1/interrupt')) { interrupted = true; return json(200, { ok: true }) }
    if (req.url.startsWith('/api/sessions')) return json(200, { sessions: [{ id: 's1' }], url: req.url })
    json(404, { error: 'nope' })
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const attach = String(server.address().port)

async function run(...argv) {
  const lines = []
  const original = console.log
  console.log = (line) => lines.push(line)
  try { const code = await runSessionCli([...argv, '--attach', attach, '--compact']); return { code, out: lines.length ? JSON.parse(lines.join('\n')) : null } } finally { console.log = original }
}

try {
  assert.equal((await run('list', '--limit', '5')).out.url, '/api/sessions?limit=5')
  assert.equal((await run('get', 'idle')).out.state, 'idle')
  const waited = await run('wait', 's1', '--until', 'idle', '--timeout', '10000')
  assert.equal(waited.code, 0); assert.equal(waited.out.reached, true); assert.ok(runningPolls >= 3)
  runningPolls = -1000
  const timedOut = await run('wait', 's1', '--until', 'idle', '--timeout', '50')
  assert.equal(timedOut.code, 3); assert.equal(timedOut.out.reached, false)
  assert.match((await run('read', 's1', '--tail', '7')).out.url, /tail=1&limit=7/)
  runningPolls = 5
  const prompted = await run('prompt', 's1', 'hello', 'world', '--wait')
  assert.deepEqual(sent, { message: 'hello world' }); assert.equal(prompted.out.ended, true); assert.equal(prompted.code, 0)
  sent = null
  assert.equal((await run('prompt', 's1', 'fire')).out.sent, true)
  assert.equal((await run('interrupt', 's1')).out.ok, true); assert.ok(interrupted)
  await assert.rejects(run('wait', 's1', '--until', 'bogus'), /--until must be/)
  await assert.rejects(run('prompt', 's1'), /needs the text/)
  await assert.rejects(run('get', 'current'), /AGENT_VIEWER_SESSION_ID/)
  await assert.rejects(run('nope'), /Unknown session verb/)
  // report: wire shape and refusals.
  await run('report', '--state', 'blocked', '--source', 'cursor-1', '--session', 's1', '--seq', '4', '--ttl', '5000')
  assert.deepEqual(reportedBody, { source: 'cursor-1', state: 'blocked', sessionId: 's1', seq: 4, ttlMs: 5000 })
  await assert.rejects(run('report', '--state', 'sleepy', '--source', 'x'), /--state must be/)
  await assert.rejects(run('report', '--state', 'idle'), /--source/)
  // A reported state shows in `get`; an SDK turn's own question outranks it.
  reportsFor.idle = [{ source: 'amp', state: 'working' }]
  const reportedState = (await run('get', 'idle')).out
  assert.equal(reportedState.state, 'working'); assert.equal(reportedState.reportedBy, 'amp')
  // explain: offline classification of a saved screen.
  const { mkdtempSync, writeFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path')
  const file = join(mkdtempSync(join(tmpdir(), 'explain-')), 'screen.txt')
  writeFileSync(file, 'some output\n──────────────\n Enter to select · ↑/↓ to navigate · Esc to cancel\n')
  const explained = (await run('explain', '--file', file)).out
  assert.equal(explained.agent, 'claude'); assert.equal(explained.winner.state, 'blocked'); assert.equal(explained.matched[0].id, 'live_blocked_form')
  assert.equal((await run('explain', '--file', file, '--agent', 'codex')).out.winner.state, 'unknown')
  await assert.rejects(run('explain', '--file', file, '--agent', 'nope'), /Unknown agent/)
  console.log('sessionCliSmoke ok')
} finally { server.close() }
