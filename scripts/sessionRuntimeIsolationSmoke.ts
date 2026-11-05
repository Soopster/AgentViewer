import assert from 'node:assert/strict'
import { withProviderInstance, currentProviderInstance } from '../lib/providerInstances'
import { setRunningSession, getRunningSession, clearRunningSession, interruptRunningSession, steerRunningSessionIdempotent, listRunningSessionRefs, setWaitingSession, clearWaitingSession, listWaitingSessions, readWaitingSessionObservation } from '../lib/sessionRuntime'

const id = `runtime-isolation-${Date.now()}`
await withProviderInstance('codex', 'codex', async () => {
  const base = currentProviderInstance()!
  const scope = <T>(name: string, run: () => T): T => globalThis.__agentViewerProviderInstanceStorage!.run({ instance: { ...base, id: name } }, run)
  const interrupted: string[] = [], steered: string[] = []
  const register = (name: string) => scope(name, () => {
    setRunningSession(id, { provider: 'codex', requestId: 'same-turn', interrupt: async () => { interrupted.push(name) }, steer: async () => { steered.push(name); return name } })
    setWaitingSession({ provider: 'codex', sessionId: id, backgroundTasks: [{ id: name, type: 'task', status: 'running', description: name }], sessionCrons: [] })
  })
  register('audit-A'); register('audit-B')
  assert.equal(getRunningSession(id, { provider: 'codex', providerInstanceId: 'audit-A' })?.providerInstanceId, 'audit-A')
  assert.equal(listRunningSessionRefs().filter(ref => ref.sessionId === id).length, 2)
  assert.equal(listWaitingSessions().filter(ref => ref.sessionId === id).length, 2)
  globalThis.__agentViewerProviderInstanceStorage!.exit(() => assert.throws(() => getRunningSession(id), /ambiguous session ID/))
  for (const name of ['audit-A', 'audit-B']) await scope(name, async () => {
    assert.equal(getRunningSession(id)?.providerInstanceId, name)
    assert.equal(readWaitingSessionObservation(id)?.providerInstanceId, name)
    await interruptRunningSession(id, 'same-turn')
    const result = await steerRunningSessionIdempotent(id, 'hello', 'same-turn', 'same-receipt')
    assert.equal(result.messageUuid, name)
    await steerRunningSessionIdempotent(id, 'hello', 'same-turn', 'same-receipt')
  })
  assert.deepEqual(interrupted, ['audit-A', 'audit-B'])
  assert.deepEqual(steered, ['audit-A', 'audit-B'])
  scope('audit-A', () => { assert.equal(clearRunningSession(id, 'stale-turn'), false); clearRunningSession(id, 'same-turn'); clearWaitingSession(id) })
  scope('audit-B', () => { assert.equal(getRunningSession(id)?.providerInstanceId, 'audit-B'); assert.equal(listWaitingSessions().filter(ref => ref.sessionId === id).length, 1); clearRunningSession(id); clearWaitingSession(id) })
  // A pending interrupt is scoped even when native session and request IDs match.
  await scope('audit-A', () => interruptRunningSession(id, 'queued-turn'))
  scope('audit-B', () => setRunningSession(id, { provider: 'codex', requestId: 'queued-turn', interrupt: async () => { interrupted.push('queued-B') } }))
  assert.equal(interrupted.includes('queued-B'), false)
  scope('audit-A', () => setRunningSession(id, { provider: 'codex', requestId: 'queued-turn', interrupt: async () => { interrupted.push('queued-A') } }))
  assert.equal(interrupted.includes('queued-A'), true)
  for (const name of ['audit-A', 'audit-B']) scope(name, () => clearRunningSession(id))
})
console.log('Runtime control, waiting state, steering receipts and pending interrupts are isolated by provider instance')
