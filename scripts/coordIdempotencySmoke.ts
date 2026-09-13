import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Each child opens its own Coordinator module/connection against one SQLite
// ledger. No mocked database or in-process-only concurrency proof.
const childMode = process.argv[2]
if (childMode) {
  const root = process.argv[3]
  process.chdir(root)
  const identity = JSON.parse(await readFile(path.join(root, 'identity.json'), 'utf8'))
  const coordination = await import('../lib/agentCoordination')
  if (childMode === 'crash') {
    await coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', 'crashed', async () => {
      await coordination.createExternalProtocolTask(identity, { title: 'Crash-safe task', detail: 'The task exists before the process exits.' })
      await appendFile(path.join(root, 'effects.log'), 'crashed\n')
      process.exit(0)
    })
  } else if (childMode === 'migration') {
    assert.deepEqual(await coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', 'legacy', async () => {
      throw new Error('legacy cached effect was repeated')
    }), { legacy: true })
  } else if (childMode === 'concurrent') {
    await coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', 'concurrent', async () => {
      await appendFile(path.join(root, 'effects.log'), 'concurrent\n')
      process.stdout.write('reserved\n')
      await new Promise((resolve) => setTimeout(resolve, 750))
      return { completed: 'concurrent' }
    })
  }
  process.exit(0)
}

const root = await mkdtemp(path.join(tmpdir(), 'coord-idempotency-'))
process.chdir(root)
process.env.AGENT_VIEWER_COORD_IDEMPOTENCY_WINDOW = '8'
const coordination = await import('../lib/agentCoordination')
const identity = (await coordination.createExternalProtocolRun({
  prompt: 'Verify durable operation reservations', provider: 'codex', baseCwd: root,
  participantName: 'idempotency-smoke', maxAgents: 2,
})).participant
await writeFile(path.join(root, 'identity.json'), JSON.stringify(identity), { mode: 0o600 })
const script = fileURLToPath(import.meta.url)
const children = new Set<ReturnType<typeof spawn>>()
const deadline = setTimeout(() => {
  for (const child of children) child.kill('SIGKILL')
  console.error('Durable idempotency smoke exceeded its 30s deadline')
  process.exit(1)
}, 30_000)
deadline.unref()
function child(mode: string) {
  const processHandle = spawn(process.execPath, [script, mode, root], { stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(processHandle)
  processHandle.once('exit', () => children.delete(processHandle))
  return processHandle
}

const crashed = child('crash')
assert.equal((await once(crashed, 'exit'))[0], 0)
let repeatEffects = 0
await assert.rejects(coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', 'crashed', async () => {
  repeatEffects += 1
  await appendFile(path.join(root, 'effects.log'), 'duplicate-crash\n')
  return { duplicated: true }
}), /outcome|running|interrupted/i)
assert.equal(repeatEffects, 0, 'a crash after the side effect must not repeat it')
assert.equal((await coordination.readExternalProtocolStatus(identity)).snapshot.tasks.filter((task) => task.title === 'Crash-safe task').length, 1)

const concurrent = child('concurrent')
const concurrentExit = once(concurrent, 'exit')
try {
  const [ready] = await once(concurrent.stdout, 'data')
  assert.match(String(ready), /reserved/)
  await assert.rejects(coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', 'concurrent', async () => {
    repeatEffects += 1
    return { duplicated: true }
  }), /outcome|running|interrupted/i)
  assert.equal(repeatEffects, 0, 'a second process must not enter the reserved operation')
  assert.equal((await concurrentExit)[0], 0)
  assert.deepEqual(await coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', 'concurrent', async () => {
    throw new Error('completed operation was rerun')
  }), { completed: 'concurrent' })
} finally {
  if (concurrent.exitCode === null) concurrent.kill('SIGKILL')
}

let sameProcessEffects = 0
const calls = await Promise.all(Array.from({ length: 8 }, () => coordination.runExternalProtocolIdempotent(
  identity, 'smoke-effect', 'same-process', async () => {
    sameProcessEffects += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return { shared: true }
  },
)))
assert.equal(sameProcessEffects, 1)
assert.ok(calls.every((result) => result.shared))
await assert.rejects(coordination.runExternalProtocolIdempotent(
  { ...identity, token: 'invalid' }, 'smoke-effect', 'same-process', async () => ({ leaked: true }),
))

const rejected = await coordination.runExternalProtocolIdempotent(identity, 'complete_task', 'gate', async () => ({ accepted: false }))
assert.equal(rejected.accepted, false)
assert.deepEqual(await coordination.runExternalProtocolIdempotent(identity, 'complete_task', 'gate', async () => ({ accepted: true })), { accepted: true })

let partialEffects = 0
await assert.rejects(coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', 'partial-error', async () => {
  partialEffects += 1
  throw new Error('failure after effect')
}), /failure after effect/)
await assert.rejects(coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', 'partial-error', async () => {
  partialEffects += 1
  return { repeated: true }
}), /effects may be partial/)
assert.equal(partialEffects, 1, 'a thrown error must not erase evidence of a possible partial effect')

for (let index = 0; index < 12; index += 1) {
  await coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', `retention-${index}`, async () => ({ index }))
}
await assert.rejects(coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', 'same-process', async () => {
  throw new Error('evicted result caused a repeated operation')
}), /expired|retained|outcome/i)
const effects = await readFile(path.join(root, 'effects.log'), 'utf8')
assert.equal(effects, 'crashed\nconcurrent\n')
// Reopen an actual v18-shaped ledger, retaining its cached results. Migration
// must populate tombstones before any of those old results are evicted.
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(path.join(root, '.agent-viewer-data', 'agent-coordination', 'coordination.sqlite'))
db.exec('DROP TABLE protocol_operation_attempts')
db.prepare("UPDATE meta SET value = '18' WHERE key = 'schema_version'").run()
db.prepare(`INSERT INTO protocol_idempotency
  (run_id, agent_id, action, request_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
  .run(identity.runId, identity.agentId, 'smoke-effect', 'legacy', JSON.stringify({ legacy: true }), new Date().toISOString())
const migrated = child('migration')
assert.equal((await once(migrated, 'exit'))[0], 0)
assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, '20')
db.prepare("DELETE FROM protocol_idempotency WHERE request_id = 'legacy'").run()
await assert.rejects(coordination.runExternalProtocolIdempotent(identity, 'smoke-effect', 'legacy', async () => {
  throw new Error('migrated effect repeated after eviction')
}), /expired/)
await coordination.stopProtocolRun(identity.runId)
await coordination.deleteProtocolRun(identity.runId)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM protocol_operation_attempts WHERE run_id = ?').get(identity.runId)?.n, 0)
db.close()
clearTimeout(deadline)
console.log('Coordinator durable idempotency smoke passed')
