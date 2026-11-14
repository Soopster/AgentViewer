import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchDetachedWorker } from '../bin/agent-viewer-coord-detached.mjs'
import { workerRecordPath, processAlive } from '../bin/agent-viewer-coord-state.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'coord-detached-'))
process.env.AGENT_VIEWER_COORD_HOME = path.join(root, 'registry')
const cli = path.join(root, 'codex.mjs')
await writeFile(cli, `#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs'
writeFileSync(process.env.PROVIDER_STARTED, String(process.pid))
while (!existsSync(process.env.PROVIDER_RELEASE)) await new Promise(resolve => setTimeout(resolve, 50))
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'detached-smoke' }))
`)
await chmod(cli, 0o700)
const launcher = fileURLToPath(new URL('../bin/agent-viewer.mjs', import.meta.url))
const identities = []
const providers = []
const daemon = createServer(async (request, response) => {
  let raw = ''
  for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw)
  response.setHeader('Content-Type', 'application/json')
  if (body.name === 'rejected') {
    response.statusCode = 409
    response.end(JSON.stringify({ error: 'Fixture run is full' }))
    return
  }
  if (body.name === 'slow') await new Promise(resolve => setTimeout(resolve, 250))
  const snapshot = { run: { id: 'detached-run', status: 'completed' }, agents: [], tasks: [], messages: [], events: [], locks: [] }
  response.end(JSON.stringify({
    participant: { runId: 'detached-run', agentId: body.name, name: body.name,
      provider: 'codex', role: body.action === 'create_run' ? 'lead' : 'teammate', token: 'fixture-secret', cwd: root },
    snapshot, actionable: { runStatus: 'completed', myTask: null },
  }))
})
daemon.listen(0, '127.0.0.1')
await once(daemon, 'listening')

async function until(read, predicate) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    let value
    try { value = await read() } catch { /* not persisted yet */ }
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Detached worker observation timed out')
}

async function launch(name, mode) {
  const identity = path.join(root, `${name}.json`)
  identities.push(identity)
  const started = path.join(root, `${name}.started`)
  const release = path.join(root, `${name}.release`)
  const child = spawn(process.execPath, [launcher, 'coord', 'worker',
    ...mode, '--detach', '--name', name, '--identity', identity, '--cwd', root,
    '--attach', String(daemon.address().port)], {
    env: { ...process.env, AGENT_VIEWER_COORD_TRANSPORT: 'http', CODEX_PATH: cli,
      PROVIDER_STARTED: started, PROVIDER_RELEASE: release },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
  const [code] = await once(child, 'exit')
  clearTimeout(timer)
  return { code, output, identity, started, release }
}

try {
  for (const [name, mode] of [['lead', ['--start', 'Detached fixture']], ['teammate', ['--join', 'detached-run', '--shared']]]) {
    const result = await launch(name, mode)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /in background as pid/)
    assert.ok(!result.output.includes('fixture-secret'))
    // The public launcher has exited; the original provider turn must survive.
    const providerPid = Number(await until(() => readFile(result.started, 'utf8'), Boolean))
    providers.push(providerPid)
    assert.ok(processAlive(providerPid), 'provider must survive launcher exit')
    const record = JSON.parse(await readFile(workerRecordPath(result.identity), 'utf8'))
    assert.ok(processAlive(record.pid), 'registered supervisor must survive launcher exit')
    assert.equal(record.activity.state, 'working')
    await writeFile(result.release, 'finish')
    await until(async () => JSON.parse(await readFile(workerRecordPath(result.identity), 'utf8')), value => value?.status === 'stopped')
    await until(() => processAlive(providerPid), value => value === false)
  }
  // An observation timeout is not cancellation: startup may already have
  // created a participant. The same detached process must finish starting.
  const slowIdentity = path.join(root, 'slow.json')
  const slowStarted = path.join(root, 'slow.started')
  const slowRelease = path.join(root, 'slow.release')
  identities.push(slowIdentity)
  await assert.rejects(launchDetachedWorker([
    '--start', 'Slow fixture', '--name', 'slow', '--identity', slowIdentity,
    '--cwd', root, '--attach', String(daemon.address().port),
  ], {
    timeoutMs: 50,
    env: { ...process.env, AGENT_VIEWER_COORD_TRANSPORT: 'http', CODEX_PATH: cli,
      PROVIDER_STARTED: slowStarted, PROVIDER_RELEASE: slowRelease },
  }), /startup is unconfirmed.*before retrying/)
  const slowProvider = Number(await until(() => readFile(slowStarted, 'utf8'), Boolean))
  providers.push(slowProvider)
  assert.ok(processAlive(slowProvider), 'startup timeout must not kill possibly accepted work')
  await writeFile(slowRelease, 'finish')
  await until(async () => JSON.parse(await readFile(workerRecordPath(slowIdentity), 'utf8')), value => value?.status === 'stopped')
  const rejected = await launch('rejected', ['--join', 'detached-run', '--shared'])
  assert.notEqual(rejected.code, 0)
  assert.match(rejected.output, /Fixture run is full/)
  assert.ok(!rejected.output.includes('in background as pid'), 'rejected startup must not report success')
  console.log('Coordinator detached startup, terminal independence, and rejection smoke passed')
} finally {
  for (const identity of identities) {
    try {
      const record = JSON.parse(await readFile(workerRecordPath(identity), 'utf8'))
      if (processAlive(record.pid)) process.kill(record.pid, 'SIGTERM')
    } catch { /* never registered or already gone */ }
  }
  for (const pid of providers) {
    if (processAlive(pid)) process.kill(pid, 'SIGTERM')
  }
  await new Promise(resolve => daemon.close(resolve))
}
