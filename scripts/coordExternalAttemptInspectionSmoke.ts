import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeWorkerRecord, workerRecordPath } from '../bin/agent-viewer-coord-state.mjs'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-external-attempt-inspection-'))
process.chdir(cwd)
process.env.AGENT_VIEWER_COORD_HOME = path.join(cwd, 'workers')
execFileSync('git', ['init', '-q'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '--allow-empty', '-qm', 'fixture'])
const coord = await import('../lib/agentCoordination')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Inspect existing execution', provider: 'codex', baseCwd: cwd, participantName: 'lead' })).participant
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'worker' })).participant
const identityFile = path.join(cwd, 'opaque-identity.json')
const attempt = { id: 'external-attempt', runId: lead.runId, agentId: worker.agentId, provider: 'codex', sessionId: 'native-thread', providerInstanceId: null, state: 'submitted', pid: null, token: 'never-expose-fixture-token', config: { secret: 'never-expose-config' } }
await writeWorkerRecord(identityFile, { runId: lead.runId, agentId: worker.agentId, status: 'failed', pid: 0, providerAttempt: attempt, providerAttempts: [attempt], token: 'never-expose-record-token' })
const recordFile = workerRecordPath(identityFile)
const record = JSON.parse(await readFile(recordFile, 'utf8'))
record.updatedAt = '2000-01-01T00:00:00.000Z'
await writeFile(recordFile, JSON.stringify(record))
const inspection = await coord.inspectExternalProtocolRecovery(lead, worker.agentId)
const external = inspection.executions[0]!.externalWorkers[0]!
assert.equal(external.attempt!.id, 'external-attempt')
assert.equal(external.attempt!.sessionId, 'native-thread')
assert.equal(external.attempt!.providerInstanceId, null)
assert.equal(external.alive, false)
assert.equal(external.providerPidAlive, null, 'missing process evidence is unknown, not proof of exit')
assert.equal(external.recoveryAction, 'inspect_before_pinned_restart')
assert.equal(JSON.stringify(inspection).includes('never-expose'), false, 'public recovery evidence must never spread worker configuration/credential fields')
assert.equal(JSON.stringify(inspection).includes(identityFile), false, 'identity file contents and private paths are absent')
assert.equal(JSON.parse(await readFile(recordFile, 'utf8')).updatedAt, record.updatedAt, 'recovery inspection does not prune or rewrite old worker records')
await assert.rejects(coord.inspectExternalProtocolRecovery(worker), /Only the Coordinator lead/)
console.log('External attempt inspection passed: authenticated run/agent matching, bounded allowlisted worker/native-session evidence, unknown account retained, credential exclusion and read-only retention.')
