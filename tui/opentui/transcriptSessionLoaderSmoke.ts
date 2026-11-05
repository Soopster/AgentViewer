import assert from 'node:assert/strict'
import type { Session } from '../../lib/types'
import type { TuiSessionDetail } from '../../lib/tui/service'
import { TranscriptSessionLoader } from './transcriptSessionLoader'
const session = { provider: 'claude', sessionId: 'one' } as Session
const pending: { resolve: (value: TuiSessionDetail) => void; reject: (error: Error) => void }[] = []
const loader = new TranscriptSessionLoader(() => new Promise((resolve, reject) => pending.push({ resolve, reject })), 2)
const first = loader.read(session, 'balanced', true, 1)
assert.equal(loader.read(session, 'balanced', true, 1), first, 'simultaneous same-revision reads must share work')
const newer = loader.read(session, 'balanced', true, 2)
await Promise.resolve()
const oldDetail = { marker: 'old' } as unknown as TuiSessionDetail
const newDetail = { marker: 'new' } as unknown as TuiSessionDetail
pending[1]!.resolve(newDetail)
await newer
pending[0]!.resolve(oldDetail)
await first
assert.equal(loader.peek(session, 'balanced', true)?.detail, newDetail, 'late older completion must not overwrite newer data')
assert.equal(loader.peek(session, 'balanced', false), undefined, 'tool variants must not collide')
const invalidated = loader.read(session, 'balanced', true, 3)
await Promise.resolve()
loader.invalidate(session)
pending[2]!.resolve(oldDetail)
await invalidated
assert.equal(loader.peek(session, 'balanced', true), undefined, 'invalidated in-flight reads must not repopulate cache')
const failure = loader.read(session, 'balanced', true, 4)
await Promise.resolve()
pending[3]!.reject(new Error('offline'))
await assert.rejects(failure, /offline/)
const retry = loader.read(session, 'balanced', true, 4)
await Promise.resolve()
pending[4]!.resolve(newDetail)
await retry
assert.equal(loader.peek(session, 'balanced', true)?.detail, newDetail)
console.log('Transcript session loader: deduplication, revision races, variant isolation, invalidation, and retry passed')

const bounded = new TranscriptSessionLoader(async () => newDetail, 2)
const second = { ...session, sessionId: 'two' }
const third = { ...session, sessionId: 'three' }
await bounded.read(session, 'balanced', true, 1)
await bounded.read(second, 'balanced', true, 1)
bounded.peek(session, 'balanced', true)
await bounded.read(third, 'balanced', true, 1)
assert.equal(bounded.peek(second, 'balanced', true), undefined, 'least recently used payload must be evicted')
assert.ok(bounded.peek(session, 'balanced', true))
const otherWorkspace = new TranscriptSessionLoader(async () => oldDetail)
assert.equal(otherWorkspace.peek(session, 'balanced', true), undefined, 'workspace instances must not share payloads')
console.log('Transcript session loader: bounded cache and workspace isolation passed')
