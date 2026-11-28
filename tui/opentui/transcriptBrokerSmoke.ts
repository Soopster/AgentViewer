import assert from 'node:assert/strict'
import type { TuiSessionDetail } from '../../lib/tui/service'
import type { Session } from '../../lib/types'
import { TranscriptSessionLoader, type TranscriptObserver } from './transcriptSessionLoader'
import { transcriptPayloadBytes } from './transcriptPayloadSize'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const session = { provider: 'codex', sessionId: 'broker' } as Session
const detail = { rawMessages: [], threadedMessages: [], text: 'large'.repeat(1000) } as unknown as TuiSessionDetail
Object.defineProperty(detail, 'search', { enumerable: true, get() { throw new Error('Accounting evaluated a lazy presentation getter') } })
assert.ok(transcriptPayloadBytes(detail) > 10000)
let reads = 0
let revision = 1
const delivered = [0, 0]
const loader = new TranscriptSessionLoader(async () => { reads++; await delay(2); return detail }, 8, 1000, 25)
const observer = (index: number): TranscriptObserver => ({
 session, density: 'balanced', tools: true, revision: () => revision,
 active: () => false, priority: () => index, shouldYield: () => false,
 onDetail: () => { delivered[index]++ }, onError: error => { throw error },
})
const offA = loader.observe(observer(0))
const offB = loader.observe(observer(1))
await delay(15)
assert.equal(reads, 1, 'two views share one source read')
assert.deepEqual(delivered, [1, 1], 'source completion publishes to every view')
assert.equal(loader.stats.entries, 1, 'visible data stays pinned even when above warm budget')
await delay(35)
assert.equal(reads, 1, 'unchanged metadata avoids repeated idle reads')
revision = 2
await delay(35)
assert.equal(reads, 2, 'new revision refreshes once for every view')
offA(); offB()
assert.equal(loader.stats.pinned, 0)
assert.equal(loader.stats.entries, 0, 'released oversized payload leaves the warm cache')
assert.equal(loader.stats.estimatedBytes, 0)
assert.equal(loader.stats.timer, false, 'hidden views leave no polling timer')
await delay(35)
assert.equal(reads, 2, 'hidden sessions are not refreshed')
const resume = loader.observe(observer(0))
await delay(15)
assert.equal(reads, 3, 'resume acquires fresh data after eviction')
resume()

const order: string[] = []
let blocked = true
const scheduler = new TranscriptSessionLoader(async target => { order.push(target.sessionId); return detail }, 8, 100000, 20)
const background = { ...observer(0), session: { ...session, sessionId: 'background' }, shouldYield: () => blocked, priority: () => 2 }
const foreground = { ...observer(0), session: { ...session, sessionId: 'foreground' }, priority: () => 0 }
const releases = [scheduler.observe(background), scheduler.observe(foreground)]
await delay(15)
assert.deepEqual(order, ['foreground'], 'yielded background work cannot block foreground work')
releases.forEach(release => release())
assert.equal(scheduler.stats.timer, false)
console.log('Transcript broker: shared revisions, hidden suspension/resume, byte budget, lazy getters and foreground priority passed')
