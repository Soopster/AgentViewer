import assert from 'node:assert/strict'
import { execFileSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StoredMachine } from '../lib/machines.mjs'
import type { RemoteCoordinatorTarget } from '../lib/tui/remoteCoordinator'
import { startRemoteMachineFixture } from './coordRemoteMachineHarness'

process.chdir(mkdtempSync(path.join(tmpdir(), 'coord-remote-machines-client-')))
const children: ChildProcess[] = []
async function start(name: string) {
  const { machine, child } = await startRemoteMachineFixture(name)
  children.push(child)
  return machine
}

try {
  const [a, b] = await Promise.all([start('alpha'), start('beta')])
  const machines = await import('../lib/machines.mjs')
  machines.writeMachines([a, b])
  const remote = await import('../lib/tui/remoteCoordinator')
  const target = (machine: StoredMachine): RemoteCoordinatorTarget => ({ machine: { name: machine.name, baseUrl: machine.baseUrl }, runId: 'shared-run', agentId: 'shared-agent', sessionId: 'shared-session', provider: 'codex' })
  const control = async (machine: StoredMachine, body?: unknown) => {
    const response = await fetch(`${machine.baseUrl}/fixture`, { headers: { ...machines.machineHeaders(machine), 'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
    assert.equal(response.status, 200)
    if (!response.ok) throw new Error(`Fixture control failed: ${response.status}`)
    return response.json()
  }
  const [first, second] = await Promise.all([remote.readRemoteCoordinator(target(a)), remote.readRemoteCoordinator(target(b))])
  assert.equal(first.messages[0]!.message.content, 'alpha transcript')
  assert.equal(second.messages[0]!.message.content, 'beta transcript')
  assert.equal(first.writeReason, null)
  const question = first.snapshot.messages.find(message => message.body === 'alpha question')!
  await remote.sendRemoteCoordinatorRequest(target(a), { action: 'message', detail: 'Use strict parsing', inReplyTo: question.id, requestId: 'alpha-reply' })
  const aAfter = await control(a), bAfter = await control(b)
  assert.ok(aAfter.snapshot.messages.find((message: { id: string; resolvedAt?: string }) => message.id === question.id)?.resolvedAt)
  const betaQuestion = bAfter.snapshot.messages.find((message: { body: string }) => message.body === 'beta question')
  assert.ok(betaQuestion)
  assert.equal(betaQuestion.resolvedAt, undefined, 'colliding identities cannot route the answer to another machine')
  assert.equal(bAfter.mutationRequests, 0)

  // Identical native ids on different daemons remain machine scoped.
  await Promise.all([control(a, { native: 'tool' }), control(b, { native: 'tool' })])
  const native = await remote.readRemoteCoordinator(target(a))
  assert.equal(native.permissionNotice, null)
  assert.match(native.permissions[0].command!, /alpha review-command/)
  const { coordinatorPermissionToken } = await import('../lib/coordinatorNativePermission')
  const nativeRequest = { action: 'native-answer' as const, detail: 'Operator answered the inspected provider request', permissionId: native.permissions[0].id, permissionToken: coordinatorPermissionToken(native.permissions[0]), response: 'once' as const, requestId: 'native-lost' }
  await control(a, { mode: 'lost' })
  await assert.rejects(remote.sendRemoteCoordinatorRequest(target(a), nativeRequest))
  assert.equal((await control(a)).nativeActions.length, 1)
  assert.equal((await control(b)).nativeActions.length, 0)
  assert.equal((await remote.readRemoteCoordinator(target(a))).permissions.length, 0)
  await remote.sendRemoteCoordinatorRequest(target(a), remote.pendingRemoteCoordinatorRequest(target(a))!)
  assert.equal((await control(a)).nativeActions.length, 1, 'retry retrieves the cached answer after the provider prompt disappears')
  assert.equal(remote.pendingRemoteCoordinatorRequest(target(a)), null)
  await control(a, { native: 'tool' })
  const beforeChange = await remote.readRemoteCoordinator(target(a))
  await control(a, { native: 'changed' })
  const staleNative = { ...nativeRequest, requestId: 'stale-native', permissionToken: coordinatorPermissionToken(beforeChange.permissions[0]) }
  await assert.rejects(remote.sendRemoteCoordinatorRequest(target(a), staleNative), /changed/)
  // Bypass the client to exercise the daemon's full-prompt guard.
  const staleResponse = await fetch(`${a.baseUrl}/api/sessions/shared-lead-session/coordination`, { method: 'POST', headers: { ...machines.machineHeaders(a), 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'codex', ...staleNative, to: 'shared-agent', expectedRunId: 'shared-run', expectedAgent: { id: 'shared-agent', sessionId: 'shared-session', provider: 'codex' } }) })
  assert.equal(staleResponse.status, 409)
  assert.equal((await control(a)).nativeActions.length, 1)
  await control(a, { native: 'question' })
  const questionView = await remote.readRemoteCoordinator(target(a))
  await remote.sendRemoteCoordinatorRequest(target(a), { action: 'native-answer', detail: 'Operator answered the inspected provider request', permissionId: questionView.permissions[0].id, permissionToken: coordinatorPermissionToken(questionView.permissions[0]), answers: { policy: ['Strict'] }, requestId: 'native-question' })
  const answered = (await control(a)).nativeActions.at(-1)
  assert.equal(answered.sessionId, 'shared-session')
  assert.equal(answered.body.action, 'respondQuestion')
  assert.deepEqual(answered.body.answers, { policy: ['Strict'] })

  // A lost POST response leaves the exact journal entry; a new read never clears it.
  await control(a, { mode: 'lost' })
  const request = { action: 'message' as const, detail: 'Retain this exact steering request', requestId: 'lost-reply' }
  await assert.rejects(remote.sendRemoteCoordinatorRequest(target(a), request))
  const pending = remote.pendingRemoteCoordinatorRequest(target(a))!
  assert.equal(pending.requestId, request.requestId)
  assert.equal(pending.expectedRunId, 'shared-run')
  const restored = execFileSync(process.execPath, ['--eval', `
    const remote = await import(${JSON.stringify(fileURLToPath(new URL('../lib/tui/remoteCoordinator.ts', import.meta.url)))});
    console.log(remote.pendingRemoteCoordinatorRequest(${JSON.stringify(target(a))}).requestId);
  `], { encoding: 'utf8' }).trim()
  assert.equal(restored, request.requestId, 'a new client process restores the exact machine-scoped request')
  await remote.readRemoteCoordinator(target(a))
  assert.ok(remote.pendingRemoteCoordinatorRequest(target(a)))
  await remote.sendRemoteCoordinatorRequest(target(a), pending)
  assert.equal(remote.pendingRemoteCoordinatorRequest(target(a)), null)
  assert.equal((await control(a)).snapshot.messages.filter((message: { body: string }) => message.body === request.detail).length, 1, 'same-key retry reconciles the actual ledger mutation')
  assert.equal(remote.pendingRemoteCoordinatorRequest(target(b)), null, 'request journals are machine scoped')

  const followUp = { action: 'delegate' as const, detail: 'Review the strict parser', paths: [], requestId: 'named-follow-up' }
  await remote.sendRemoteCoordinatorRequest(target(a), followUp)
  await remote.sendRemoteCoordinatorRequest(target(a), followUp)
  const following = await control(a)
  assert.equal(following.snapshot.tasks.length, 1, 'same-key follow-up creates exactly one task')
  const task = following.snapshot.tasks[0]
  assert.equal(task.ownerAgentId, 'shared-agent', 'follow-up reuses the selected teammate')
  assert.equal(following.snapshot.agents.length, 2, 'follow-up does not allocate another seat')
  assert.equal(following.providerTurns, 0, 'mail and follow-up assignment cannot take over a cooperative session turn')
  await control(a, { planTaskId: task.id })
  await remote.sendRemoteCoordinatorRequest(target(a), { action: 'review-plan', approved: true, taskId: task.id, detail: 'Plan reviewed', requestId: 'review-plan' })
  assert.equal((await control(a)).snapshot.tasks[0].status, 'claimed', 'remote plan approval releases the plan gate')
  await control(a, { armTurn: true })
  await remote.sendRemoteCoordinatorRequest(target(a), { action: 'interrupt-agent', detail: 'Pause review', requestId: 'interrupt' })
  const interrupted = await control(a)
  assert.equal(interrupted.interrupts, 1, 'interrupt reached the owning daemon runtime')
  assert.equal(interrupted.snapshot.tasks[0].ownerAgentId, 'shared-agent', 'interrupt preserves task ownership')

  // Client capability and daemon proxy enforce read-only independently.
  machines.writeMachines([{ ...a, scope: 'read-only', credential: a.readOnly }, b])
  assert.match((await remote.readRemoteCoordinator(target(a))).writeReason!, /Read-only/)
  await assert.rejects(remote.sendRemoteCoordinatorRequest(target(a), { ...request, requestId: 'read-only-denied' }), /Read-only/)
  const denied = await fetch(`${a.baseUrl}/api/sessions/shared-lead-session/coordination`, { method: 'POST', headers: { ...machines.machineHeaders({ credential: a.readOnly }), 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'codex', action: 'message', to: 'shared-agent', detail: 'Forbidden input', requestId: 'forged-full' }) })
  assert.equal(denied.status, 403, 'daemon proxy rejects a read-only credential despite a forged client scope')
  machines.writeMachines([a, b])

  // Server guard, not just the panel, refuses a stale run or teammate identity.
  for (const guard of [{ expectedRunId: 'wrong-run' }, { expectedRunId: 'shared-run', expectedAgent: { id: 'shared-agent', sessionId: 'wrong-session', provider: 'codex' } }]) {
    const response = await fetch(`${a.baseUrl}/api/sessions/shared-lead-session/coordination`, { method: 'POST', headers: { ...machines.machineHeaders(a), 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'codex', action: 'message', to: 'shared-agent', detail: 'Stale input', requestId: 'stale-input', ...guard }) })
    assert.equal(response.status, 409)
    if (response.status !== 409) throw new Error('Expected stale identity rejection')
    assert.match((await response.json()).error, /changed/)
  }
  assert.equal((await control(a)).snapshot.messages.some((message: { body: string }) => message.body === 'Stale input'), false)

  // The answer can finish a team before the lost response reaches the client.
  const betaNative = (await remote.readRemoteCoordinator(target(b))).permissions[0]
  const betaAnswer = { ...nativeRequest, requestId: 'beta-terminal-answer', permissionToken: coordinatorPermissionToken(betaNative) }
  await control(b, { mode: 'lost' })
  await assert.rejects(remote.sendRemoteCoordinatorRequest(target(b), betaAnswer))
  await control(b, { finishRun: true })
  await remote.sendRemoteCoordinatorRequest(target(b), remote.pendingRemoteCoordinatorRequest(target(b))!)
  assert.equal((await control(b)).nativeActions.length, 1, 'terminal-team retry retrieves the durable receipt without a provider call')
  assert.equal(remote.pendingRemoteCoordinatorRequest(target(b)), null)

  await control(a, { mode: 'offline' })
  const slow = remote.readRemoteCoordinator(target(a))
  const slowRejected = assert.rejects(slow)
  const started = Date.now()
  assert.equal((await remote.readRemoteCoordinator(target(b))).messages[0]!.message.content, 'beta transcript')
  assert.ok(Date.now() - started < 2000, 'one stalled machine cannot block another')
  await slowRejected
  await control(a, { mode: 'normal', revoke: true })
  await assert.rejects(remote.readRemoteCoordinator(target(a)), /credential revoked|access denied/i)
  console.log('Remote machines: two isolated route/auth/ledger daemons, colliding identities, reply, restart/lost-response replay, follow-up reuse, native prompt identity/lost-response/question routing, plan approval, interrupt ownership, read-only proxy gate, identity guard, independent outage and revoked credentials passed')
} finally {
  for (const child of children) child.kill('SIGTERM')
}
