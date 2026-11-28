import assert from 'node:assert/strict'
import { OpenCode2History, OPENCODE_HISTORY_FULL_REFRESH_MS, readOpenCodeHistorySignature } from '../lib/opencode2History'
import type { V2Message } from '../lib/opencode2Mapping'

const fixture = (count: number): V2Message[] => Array.from({ length: count }, (_, index) => ({
  id: `message-${index}`, type: 'user', text: `Message ${index}`, time: { created: index + 1 },
}))
let server = fixture(2405)
let now = 100
let requests = 0
let bytes = 0
const loadPage = async (_session: string, cursor: string | undefined) => {
  requests += 1
  const offset = Number(cursor ?? 0)
  const data = structuredClone([...server].reverse().slice(offset, offset + 200))
  const page = { data, cursor: { next: offset + data.length < server.length ? String(offset + data.length) : null } }
  bytes += JSON.stringify(page).length
  return page
}
const cache = new OpenCode2History(loadPage, () => now)
const cold = await cache.read('session')
assert.deepEqual(cold, server)
assert.equal(requests, 13)
const coldBytes = bytes
requests = 0; bytes = 0
const idle = await cache.read('session')
assert.equal(idle, cold, 'idle verification must preserve snapshot identity')
assert.equal(requests, 1)
const warmBytes = bytes
const signature = readOpenCodeHistorySignature(idle)
server[server.length - 1]!.text = 'Growing text with the same message id'
requests = 0
const grown = await cache.read('session')
assert.equal(requests, 1)
assert.deepEqual(grown, server)
assert.equal(grown[0], idle[0], 'old prefix objects are immutable and reusable')
assert.notEqual(readOpenCodeHistorySignature(grown), signature)
server.push(...fixture(501).map((message, index) => ({ ...message, id: `new-${index}`, time: { created: 3000 + index } })))
requests = 0
assert.deepEqual(await cache.read('session'), server)
assert.equal(requests, 3, 'a burst larger than one page must walk until it finds a safe overlap')

server.splice(server.length - 100, 1)
requests = 0
assert.deepEqual(await cache.read('session'), server)
assert.ok(requests > 1, 'a deleted message in the overlap forces a complete read')
server = server.slice(0, 1000)
assert.deepEqual(await cache.read('session'), server, 'reverts must drop the obsolete suffix')
const beforeHistoricalEdit = await cache.read('session')
server[12]!.text = 'An older message changed without changing the tail'
cache.noteEvent({ type: 'session.message.content.updated', data: { sessionID: 'session', messageID: server[12]!.id } })
requests = 0
const edited = await cache.read('session')
assert.deepEqual(edited, server)
assert.equal(requests, 5)
assert.notEqual(readOpenCodeHistorySignature(edited), readOpenCodeHistorySignature(beforeHistoricalEdit))
server[13]!.text = 'An update whose event was lost'
now += OPENCODE_HISTORY_FULL_REFRESH_MS
requests = 0
assert.deepEqual(await cache.read('session'), server)
assert.equal(requests, 5, 'periodic complete verification catches missed historical events')
for (const event of ['session.revert.staged', 'session.revert.cleared', 'session.revert.committed', 'session.compaction.ended', 'session.deleted']) {
  cache.noteEvent({ type: event, data: { sessionID: 'session' } })
  requests = 0
  assert.deepEqual(await cache.read('session'), server)
  assert.equal(requests, 5, event)
}
cache.invalidate() // same boundary used when an event stream reconnects
requests = 0
assert.deepEqual(await cache.read('session'), server)
assert.equal(requests, 5)

const coalesced = new OpenCode2History(loadPage)
requests = 0
const first = coalesced.read('same')
const second = coalesced.read('same')
assert.equal(first, second)
assert.equal(await first, await second)
assert.equal(requests, 5, 'simultaneous info/model/transcript reads must share their page walk')
const aborted = new AbortController()
aborted.abort()
await assert.rejects(coalesced.read('cancelled', { signal: aborted.signal }), { name: 'AbortError' })

let release!: () => void
const gate = new Promise<void>(resolve => { release = resolve })
let pause = true
const racing = new OpenCode2History(async (session, cursor) => {
  const page = await loadPage(session, cursor)
  if (pause) { pause = false; await gate }
  return page
})
const stale = racing.read('racing')
racing.invalidate('racing')
release()
await stale
requests = 0
await racing.read('racing')
assert.equal(requests, 5, 'an invalidated in-flight read must not repopulate the cache')

let resume!: () => void
const waiting = new Promise<void>(resolve => { resume = resolve })
let hold = true
const eventRace = new OpenCode2History(async (session, cursor) => {
  const page = await loadPage(session, cursor)
  if (hold) { hold = false; await waiting }
  return page
})
const beforeRevert = eventRace.read('event-race')
eventRace.noteEvent({ type: 'session.revert.committed', data: { sessionID: 'event-race' } })
server[server.length - 1]!.text = 'After revert'
const afterRevert = eventRace.read('event-race')
assert.notEqual(afterRevert, beforeRevert, 'post-revert callers must not join a stale pending request')
await afterRevert
resume()
await beforeRevert
requests = 0
assert.deepEqual(await eventRace.read('event-race'), server)
assert.equal(requests, 1, 'the late pre-revert response must not overwrite the newer cached snapshot')

requests = 0
const evicted = new OpenCode2History(loadPage)
for (let index = 0; index < 5; index += 1) await evicted.read(`session-${index}`)
requests = 0
await evicted.read('session-0')
assert.equal(requests, 5, 'only four histories may be retained')
const oversized = new OpenCode2History(loadPage)
server = fixture(201)
server[0]!.text = 'x'.repeat(4_000_001)
await oversized.read('large')
requests = 0
await oversized.read('large')
assert.equal(requests, 2, 'oversized snapshots remain readable without being retained')

const broken = new OpenCode2History(async () => ({ data: fixture(200), cursor: { next: 'same' } }))
await assert.rejects(broken.read('broken'), /repeated.*cursor/)
console.log(`OpenCode history cache smoke passed: idle requests 13 → 1, response bytes ${coldBytes} → ${warmBytes}; tail growth, bursts, edits, reverts, missed events, reconnects, races, cancellation, and cache bounds`)
