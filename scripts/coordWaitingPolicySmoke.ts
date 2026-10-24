import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { coordinatorWaitingPolicy as policy } from '../lib/coordinatorWaitingPolicy'

assert.equal(policy({ id: 'external', sessionId: 'external:codex' }, false).mode, 'interactive')
assert.equal(policy({ id: 'external', sessionId: 'external:codex', capabilities: { unattended: true } }, false).idleAction, 'return_to_supervisor')
assert.equal(policy({ id: 'native', sessionId: 'native-id' }, false).mode, 'unknown', 'native ID alone cannot prove supervision')
assert.equal(policy({ id: 'native', sessionId: 'native-id' }, true).mode, 'managed')
assert.equal(policy({ id: 'coop-existing', sessionId: 'native-id' }, true).idleAction, 'return_to_user', 'a cooperative participant is not a spawned worker')
const cwd = mkdtempSync(path.join(tmpdir(), 'coord-waiting-policy-'))
process.chdir(cwd)
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const lead = (await coord.createExternalProtocolRun({ prompt: 'Caller waiting policy', provider: 'codex', baseCwd: cwd, participantName: 'interactive-lead' })).participant
const interactive = await coord.readExternalProtocolStatus(lead)
assert.equal(interactive.actionable.waitingPolicy!.mode, 'interactive')
assert.equal(interactive.actionable.waitingPolicy!.coordWaitAllowed, true)
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', participantName: 'managed-worker', cwd, capabilities: { unattended: true } })).participant
const managed = await execute({ ...worker, action: 'status' }) as Awaited<ReturnType<typeof coord.readExternalProtocolStatus>>
assert.equal(managed.actionable.waitingPolicy!.source, 'unattended-capability')
assert.equal(managed.actionable.waitingPolicy!.coordWaitAllowed, false, 'model returns; supervisor can still use the wait API')
const waited = await execute({ ...worker, action: 'wait', timeoutMs: 0 }) as Awaited<ReturnType<typeof coord.waitForExternalProtocolChange>>
assert.equal(waited.actionable.waitingPolicy!.idleAction, 'return_to_supervisor', 'supervisor reads carry the same model-turn guidance')
await coord.resumeExternalProtocolParticipant(worker, { client: { name: 'interactive-client', protocolVersion: 2 }, capabilities: { unattended: false } })
assert.equal((await coord.readExternalProtocolStatus(worker)).actionable.waitingPolicy!.mode, 'interactive', 'renegotiation updates the policy')
await coord.configureInteractiveCoordinator({ sessionId: 'native-lead', provider: 'codex', cwd, autoContinue: false })
const nativeLead = await coord.sessionCoordinatorIdentity('native-lead', 'codex')
assert.equal((await coord.readExternalProtocolStatus(nativeLead)).actionable.waitingPolicy!.source, 'managed-binding', 'persisted app hosting reports management even when auto-continue is disabled')
console.log('Waiting policy passed: negotiated supervision, interactive fallback, cooperative/unknown hosts, wait digest, renegotiation and app binding independent of auto-continue.')
process.exit(0)
