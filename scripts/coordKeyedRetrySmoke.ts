import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// A keyed operation that fails before any side effect must release its
// request_id, so the corrected retry runs. One that wrote must stay fenced.
const root = await mkdtemp(path.join(tmpdir(), 'coord-keyed-retry-'))
process.chdir(root)
const coordination = await import('../lib/agentCoordination')
const identity = (await coordination.createExternalProtocolRun({
  prompt: 'Verify keyed retry release', provider: 'codex', baseCwd: root,
  participantName: 'keyed-retry-smoke', maxAgents: 2,
})).participant

// 1. Validation failure before any write, then a corrected retry under the same key.
await assert.rejects(
  coordination.runExternalProtocolIdempotent(identity, 'smoke-keyed', 'validation', async () => {
    throw new Error('task title and detail are required')
  }),
  /task title and detail are required/,
)
assert.deepEqual(await coordination.runExternalProtocolIdempotent(identity, 'smoke-keyed', 'validation', async () => ({ corrected: true })), { corrected: true })

// 2. A failure after a write keeps the key fenced as uncertain.
await assert.rejects(
  coordination.runExternalProtocolIdempotent(identity, 'smoke-keyed', 'after-write', async () => {
    await coordination.createExternalProtocolTask(identity, { title: 'Written before failure', detail: 'The task exists.' })
    throw new Error('gate crashed after the task was written')
  }),
  /gate crashed after the task was written/,
)
await assert.rejects(
  coordination.runExternalProtocolIdempotent(identity, 'smoke-keyed', 'after-write', async () => ({ retried: true })),
  /COORDINATOR_OPERATION_UNCERTAIN/,
)

// 3. A rejected completion (accepted:false) still releases the key, as before.
assert.deepEqual(await coordination.runExternalProtocolIdempotent(identity, 'smoke-keyed', 'gate', async () => ({ accepted: false, reason: 'missing evidence' })), { accepted: false, reason: 'missing evidence' })
assert.deepEqual(await coordination.runExternalProtocolIdempotent(identity, 'smoke-keyed', 'gate', async () => ({ accepted: true })), { accepted: true })

console.log('coordKeyedRetrySmoke passed')
process.exit(0)
