import assert from 'node:assert/strict'
import { sessionIdentityKey } from '../lib/sessionIdentity'
import type { Session } from '../lib/types'

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }
const instances = [
  { id: 'personal', provider: 'codex' as const },
  { id: 'work', provider: 'codex' as const },
  { id: 'claude', provider: 'claude' as const },
  { id: 'claude-acp', provider: 'claude-acp' as const },
]
const listCalls: string[] = [], queued: string[] = [], steered: string[] = []
const providerInstances = await import('../lib/providerInstances')
mock.module('../lib/providerInstances', () => ({ ...providerInstances,
  listProviderInstances: async () => instances,
  withProviderInstance: async (id: string | undefined, provider: string, run: () => Promise<Response>) => {
    assert.equal(provider, 'codex'); queued.push(id!); return run()
  },
}))
const runtime = await import('../lib/sessionRuntime')
mock.module('../lib/sessionRuntime', () => ({ ...runtime,
  listRunningSessionRefs: () => [{ sessionId: 'same', provider: 'codex', providerInstanceId: 'work' }],
  getRunningSessionInfo: (_id: string, target: Session) => ({ running: target.providerInstanceId === 'work', canSteer: true }),
  steerRunningSessionIdempotent: async (_id: string, _text: string, _attachments: unknown, _request: string, target: Session) => {
    steered.push(sessionIdentityKey(target)); return { delivered: true }
  },
}))
mock.module('../lib/sessionBackend', () => ({
  listViewSessions: async (params: { provider: Session['provider']; providerInstanceId: string }) => {
    listCalls.push(params.providerInstanceId)
    return [{ sessionId: 'same', provider: params.provider, providerInstanceId: params.providerInstanceId, summary: 'Recipient', lastModified: Date.now() }]
  },
  streamViewSessionTurn: async (params: { provider: string; body: Record<string, unknown> }) => {
    assert.equal(params.provider, 'codex')
    assert.equal(params.body.providerInstanceId, 'personal')
    assert.equal(params.body.detachOnClientAbort, true)
    return new Response('event: turn-accepted\ndata: {"sessionId":"same","provider":"codex"}\n\ndata: {"type":"done"}\n\n')
  },
}))
const { listAddressableSessions, resolveAddressableSession, sendCrossSessionMessage } = await import('../lib/crossSessionMessaging')
const sessions = await listAddressableSessions()
assert.deepEqual([...listCalls].sort(), ['claude', 'personal', 'work'])
assert.equal(sessions.length, 3, 'discovery preserves colliding native IDs across providers and accounts')
assert.equal(sessions.filter(session => session.running).length, 1)
assert.equal(sessions.find(session => session.running)?.providerInstanceId, 'work')
assert.equal(resolveAddressableSession(sessions, 'same'), undefined, 'ambiguous legacy IDs fail closed')
assert.equal(resolveAddressableSession(sessions, 'codex@work:same')?.providerInstanceId, 'work')
const excluded = await listAddressableSessions('codex@personal:same')
assert.equal(excluded.length, 2, 'excluding a sender does not hide another account with the same ID')
assert.equal(excluded.some(session => session.providerInstanceId === 'work'), true)
const delivered = await sendCrossSessionMessage({ fromName: 'Fixture', toName: 'codex@work:same', text: 'Live recipient' })
assert.equal(delivered.delivered, true)
assert.equal(delivered.mode, 'steered')
assert.equal(delivered.targetProviderInstanceId, 'work')
assert.deepEqual(steered, ['codex@work:same'])
const started = await sendCrossSessionMessage({ fromName: 'Fixture', toName: 'codex@personal:same', text: 'Idle recipient' })
assert.equal(started.delivered, true)
assert.equal(started.mode, 'queued')
assert.equal(started.targetProviderInstanceId, 'personal')
assert.deepEqual(queued, ['personal'])
const ambiguous = await sendCrossSessionMessage({ fromName: 'Fixture', toName: 'same', text: 'Refuse ambiguous recipient' })
assert.equal(ambiguous.mode, 'not_found')
assert.equal(steered.length, 1)
assert.equal(queued.length, 1)
console.log('Messaging identity integration: PASS (configured-instance discovery, colliding IDs, sender exclusion, targeted steering, idle context and ambiguous address refusal)')
