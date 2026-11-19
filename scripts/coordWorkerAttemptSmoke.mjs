import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { processAlive, workerRecordPath } from '../bin/agent-viewer-coord-state.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'coord-worker-attempt-'))
const identity = path.join(root, 'identity.json')
const count = path.join(root, 'count')
const mode = path.join(root, 'mode')
await writeFile(count, '0')
await writeFile(mode, 'hang')
const provider = path.join(root, 'provider.mjs')
await writeFile(provider, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
const count = ${JSON.stringify(count)}
writeFileSync(count, String(Number(readFileSync(count, 'utf8')) + 1))
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'retained-native-session' }))
if (readFileSync(${JSON.stringify(mode)}, 'utf8') === 'hang') setInterval(() => {}, 1000)
`)
await chmod(provider, 0o700)
const daemon = createServer(async (request, response) => {
  let raw = ''
  for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw)
  response.setHeader('Content-Type', 'application/json')
  const snapshot = { run: { id: 'attempt-run', status: 'running' }, agents: [], tasks: [], locks: [], messages: [], events: [] }
  response.end(JSON.stringify(body.action === 'join_run' || body.action === 'resume'
    ? { participant: { runId: 'attempt-run', agentId: 'worker', name: 'worker', role: 'teammate', token: 'fixture-token', provider: 'codex', cwd: root }, snapshot }
    : { snapshot, actionable: { myTask: { id: 'owned-task', status: 'in_progress', planState: 'approved' }, inboxCount: 0 }, cursor: 'cursor' }))
})
daemon.listen(0, '127.0.0.1')
await once(daemon, 'listening')
const attach = `http://127.0.0.1:${daemon.address().port}`
const worker = fileURLToPath(new URL('../bin/agent-viewer-coord-worker.mjs', import.meta.url))
const admin = fileURLToPath(new URL('../bin/agent-viewer-coord-admin.mjs', import.meta.url))
const env = { ...process.env, CODEX_PATH: provider, AGENT_VIEWER_COORD_HOME: path.join(root, 'home'), AGENT_VIEWER_COORD_TRANSPORT: 'http' }
process.env.AGENT_VIEWER_COORD_HOME = env.AGENT_VIEWER_COORD_HOME
const children = []
const launch = (args, entry = worker) => {
  const child = spawn(process.execPath, [entry, ...args], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  return child
}
const exited = child => new Promise(resolve => child.once('exit', code => resolve(code)))
const until = async check => {
  for (let i = 0; i < 500; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('worker attempt did not reach expected state')
}
let providerPid
try {
  const initial = launch(['--join', 'attempt-run', '--name', 'worker', '--shared', '--identity', identity, '--attach', attach])
  await until(async () => {
    try {
      const state = JSON.parse(await readFile(identity, 'utf8'))
      providerPid = state.providerAttempt?.pid
      return providerPid && state.providerSessionId === 'retained-native-session'
    } catch { return false }
  })
  const original = JSON.parse(await readFile(identity, 'utf8')).providerAttempt
  const stopped = exited(initial)
  initial.kill('SIGKILL')
  await stopped
  assert.equal(processAlive(providerPid), true, 'crashed supervisor leaves its detached provider observable')
  for (const args of [[], ['--provider', 'claude'], ['--reconcile-attempt', original.id]]) {
    const rejected = launch(['--identity', identity, '--attach', attach, ...args])
    assert.equal(await exited(rejected), 1)
    assert.equal(await readFile(count, 'utf8'), '1', 'restart may not start a second provider while the old child lives')
  }
  for (const args of [[], ['--reconcile-attempt', original.id]]) {
    const rejected = launch(['restart', identity, ...args], admin)
    assert.equal(await exited(rejected), 1, 'admin restart must reject an orphaned live provider before launching a supervisor')
    assert.equal(await readFile(count, 'utf8'), '1')
  }
  process.kill(providerPid, 'SIGKILL')
  await until(() => !processAlive(providerPid))
  const stale = launch(['--identity', identity, '--attach', attach, '--reconcile-attempt', 'stale-pin'])
  assert.equal(await exited(stale), 1)
  await writeFile(mode, 'finish')
  const recovered = launch(['--identity', identity, '--attach', attach, '--reconcile-attempt', original.id, '--once'])
  assert.equal(await exited(recovered), 0)
  assert.equal(await readFile(count, 'utf8'), '2', 'exact explicit reconciliation permits one provider turn')
  const record = JSON.parse(await readFile(workerRecordPath(identity), 'utf8'))
  assert.equal(record.providerAttempts.find(attempt => attempt.id === original.id).state, 'reconciled')
  assert.equal(record.providerAttempt.state, 'closed')
  assert.equal(record.providerAttempt.sessionId, 'retained-native-session')
  assert.equal(record.providerAttempt.providerInstanceId, null, 'unobserved provider account remains unknown')
  assert.ok(record.providerAttempts.length <= 10)
  console.log('Worker attempts passed: killed supervisor retains a live detached child; default/provider-change/pinned restarts refuse duplicates, stale pins reject, exact post-stop reconciliation starts one turn and preserves history/session.')
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  if (providerPid && processAlive(providerPid)) try { process.kill(providerPid, 'SIGKILL') } catch {}
  daemon.close()
}
