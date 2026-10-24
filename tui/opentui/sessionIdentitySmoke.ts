import assert from 'node:assert/strict'
import type { Session } from '../../lib/types'
import type { TuiSessionDetail } from '../../lib/tui/service'
import { sessionIdentityKey, sessionVariantKey, sessionVariantParts } from './sessionIdentity'
import { TranscriptSessionLoader } from './transcriptSessionLoader'
import { SessionCacheBudget } from './sessionCacheBudget'
import { TranscriptDetailCache } from './transcriptDetailCache'
import { windowSessionKey } from './windowTargets'
import { transcriptSessionKey } from './splitPaneState'
import { deskSessionKey } from './deskModel'
import { liveMessageSessionKey, upsertThreadedMessage } from './liveTranscriptState'

const defaultSession: Session = { provider: 'codex', sessionId: 'same:id|with:delimiters' }
const first = { ...defaultSession, providerInstanceId: 'work' }
const second = { ...defaultSession, providerInstanceId: 'personal' }
assert.equal(sessionIdentityKey(defaultSession), `codex:${defaultSession.sessionId}`, 'default persisted keys remain compatible')
assert.equal(sessionIdentityKey({ ...defaultSession, providerInstanceId: 'codex' }), sessionIdentityKey(defaultSession))
assert.equal(new Set([defaultSession, first, second].map(sessionIdentityKey)).size, 3)
assert.notEqual(sessionIdentityKey({ ...first, providerInstanceId: 'a:b' }), sessionIdentityKey({ ...first, providerInstanceId: 'a', sessionId: `b:${first.sessionId}` }))
assert.deepEqual(sessionVariantParts(sessionVariantKey(sessionIdentityKey(first), 'balanced|1')), [sessionIdentityKey(first), 'balanced|1'])
assert.notEqual(sessionVariantKey('codex:id|balanced', '1'), sessionVariantKey('codex:id', 'balanced|1'), 'internal variant delimiters cannot alias a native session ID')
for (const key of [windowSessionKey, transcriptSessionKey, deskSessionKey]) {
  assert.equal(key(first), sessionIdentityKey(first), 'windows, reader and desk share the cache identity')
}
const budget = new SessionCacheBudget(100)
const cache = new TranscriptDetailCache(budget)
budget.retain(sessionIdentityKey(first))
cache.set(sessionIdentityKey(first), { estimatedRetainedBytes: 60 } as TuiSessionDetail)
cache.set(sessionIdentityKey(second), { estimatedRetainedBytes: 60 } as TuiSessionDetail)
assert.ok(cache.has(sessionIdentityKey(first)))
assert.ok(!cache.has(sessionIdentityKey(second)), 'pinning one instance must not pin its sibling')
budget.release(sessionIdentityKey(first))
const reads: string[] = []
const loader = new TranscriptSessionLoader(async session => {
  reads.push(sessionIdentityKey(session))
  return { marker: session.providerInstanceId } as unknown as TuiSessionDetail
})
const details = await Promise.all([loader.read(first, 'balanced', true, 1), loader.read(second, 'balanced', true, 1)])
assert.equal(reads.length, 2, 'instances must not deduplicate source reads')
assert.notEqual(details[0], details[1])
const liveA = { role: 'assistant' as const, uuid: 'same-uuid', ...first, blocks: [] }
const liveB = { ...liveA, ...second }
const live = upsertThreadedMessage(upsertThreadedMessage([], liveA), liveB)
assert.equal(live.length, 2, 'native live UUIDs are scoped to their provider instance')
assert.notEqual(liveMessageSessionKey(live[0]!), liveMessageSessionKey(live[1]!))
assert.equal(loader.peek(first, 'balanced', true)?.detail, details[0])
loader.invalidate(first)
assert.equal(loader.peek(first, 'balanced', true), undefined)
assert.equal(loader.peek(second, 'balanced', true)?.detail, details[1], 'invalidation is instance-local')
console.log('Session identity passed: default compatibility, delimiter safety, window parity, independent reads, pins and invalidation')
