import assert from 'node:assert/strict'
// @ts-ignore -- Bun's test helpers are available to standalone smoke scripts.
import { mock } from 'bun:test'
// @ts-ignore -- Bun-only heap diagnostics.
import { heapStats } from 'bun:jsc'
import { buildThreadedMessages, stripToolCallBlocks } from '../../lib/threading'
import type { SessionMessage } from '../../lib/types'
import { formatTranscriptCards } from '../format'
import { restoreDeliveredPrefix } from './transcriptDelivery'

const session = { provider: 'codex' as const, sessionId: 'delivery-smoke' }
const makeMessage = (i: number): SessionMessage => ({
  uuid: `delivery-${i}`, session_id: session.sessionId,
  type: i % 2 ? 'assistant' : 'user', parent_tool_use_id: null,
  message: { role: i % 2 ? 'assistant' : 'user', content: `Message ${i}: ${'representative content '.repeat(24)}` },
})
let raw = Array.from({ length: 10000 }, (_, i) => makeMessage(i))
let holdNextSource = false
const sourceGate: { release?: () => void } = {}
mock.module('../../lib/tui/reads', () => ({
  readTuiSessionDetailSource: async () => {
    const result = { info: null, rawMessages: structuredClone(raw) }
    if (!holdNextSource) return result
    holdNextSource = false
    return new Promise<typeof result>((resolve) => { sourceGate.release = () => resolve(result) })
  },
  readTuiSessionMetadata: async () => ({}),
  readTuiSessions: async () => [],
  readTuiSlashCommands: async () => [],
  readTuiComposerOptions: async () => ({}),
  readTuiSubagentSummaries: async () => [],
}))

// Exercise the real worker handler and client together, including actual clone
// semantics, without provider SDKs or a user's session data.
type Wire = { id: number; suffixOnly?: boolean; rawMessages?: unknown[]; threadedMessages?: unknown[]; transcriptCards?: unknown[]; previousDeliveryToken?: number; previousFormatToken?: number; densityCards?: unknown[]; cardsPatch?: unknown[] }
let latestWire: Wire = { id: 0 }
let stripRequestToken = false
let stripFormatToken = false
let deferResponses = false
const responses: MessageEvent[] = []
let receiver: ((event: MessageEvent) => void) | null = null
const scope = globalThis as unknown as { self: unknown }
const workerScope = {
  onmessage: null as ((event: MessageEvent) => Promise<void>) | null,
  postMessage(data: Wire) {
    latestWire = data
    const event = { data: structuredClone(data) } as MessageEvent
    if (deferResponses) responses.push(event)
    else receiver?.(event)
  },
}
scope.self = workerScope
await import('./threadingWorker')
let requestsPosted = 0
class LocalWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror = null
  postMessage(data: Wire) {
    requestsPosted += 1
    receiver = this.onmessage
    const request = structuredClone(data)
    if (stripRequestToken) delete request.previousDeliveryToken
    if (stripFormatToken) delete request.previousFormatToken
    void workerScope.onmessage!({ data: request } as MessageEvent)
  }
  unref() {}
  terminate() {}
}
Object.assign(globalThis, { Worker: LocalWorker })
const { readAndBuildTranscriptAsync, formatTranscriptCardsAsync, getTranscriptCardsSync } = await import('./threadingWorkerClient')
const read = (density: 'balanced' | 'dense' = 'balanced', showToolCalls = true) => readAndBuildTranscriptAsync(session, density, showToolCalls)
const initial = await read()
assert.equal(latestWire.suffixOnly, false)
assert.deepEqual(initial.transcriptCards, formatTranscriptCards(buildThreadedMessages(raw)))
const idle = await read()
assert.equal(idle.rawMessages, initial.rawMessages)
assert.equal(idle.transcriptCards, initial.transcriptCards)
raw = [...raw, makeMessage(raw.length)]
const appended = await read()
assert.equal(latestWire.suffixOnly, true)
assert.equal(latestWire.rawMessages?.length, 1)
assert.equal(appended.rawMessages[0], initial.rawMessages[0])
assert.equal(appended.transcriptCards[0], initial.transcriptCards[0])
assert.deepEqual(appended.rawMessages, raw)
assert.deepEqual(appended.transcriptCards, formatTranscriptCards(buildThreadedMessages(raw)))
const suffixWire = latestWire
const fullWire = { ...suffixWire, suffixOnly: false, rawMessages: appended.rawMessages, threadedMessages: appended.threadedMessages, transcriptCards: appended.transcriptCards }
function cloneMedian(value: unknown): number {
  const times: number[] = []
  for (let i = 0; i < 15; i++) {
    const start = performance.now()
    structuredClone(value)
    if (i >= 3) times.push(performance.now() - start)
  }
  return times.sort((a, b) => a - b)[Math.floor(times.length / 2)]
}
function cloneHeapBytes(value: unknown): number {
  const bun = (globalThis as unknown as { Bun: { gc(sync: boolean): void } }).Bun
  bun.gc(true)
  const before = heapStats().heapSize
  const clone = structuredClone(value)
  bun.gc(true)
  const bytes = heapStats().heapSize - before
  // Keep the clone live through the second measurement.
  assert.ok(clone)
  return bytes
}
const transfer = {
  fullBytes: Buffer.byteLength(JSON.stringify(fullWire)),
  suffixBytes: Buffer.byteLength(JSON.stringify(suffixWire)),
  fullCloneHeapBytes: cloneHeapBytes(fullWire),
  suffixCloneHeapBytes: cloneHeapBytes(suffixWire),
  fullCloneMedianMs: cloneMedian(fullWire),
  suffixCloneMedianMs: cloneMedian(suffixWire),
}
assert.ok(transfer.suffixBytes < transfer.fullBytes / 100)
raw = raw.slice(0, -5)
const truncated = await read()
assert.deepEqual(truncated.rawMessages, raw)
assert.deepEqual(truncated.transcriptCards, formatTranscriptCards(buildThreadedMessages(raw)))
raw = raw.map((msg, i) => i === 12 ? { ...msg, message: { role: 'user' as const, content: 'mutated earlier message' } } : msg)
const mutated = await read()
assert.deepEqual(mutated.rawMessages, raw)
assert.deepEqual(mutated.transcriptCards, formatTranscriptCards(buildThreadedMessages(raw)))
const dense = await read('dense')
assert.equal(latestWire.suffixOnly, false)
assert.deepEqual(dense.transcriptCards, formatTranscriptCards(buildThreadedMessages(raw), 'dense'))
// Simulate a missing/stale request baseline while the client retains its old
// delivery: the worker must supply complete arrays, never an unusable suffix.
stripRequestToken = true
raw = [...raw, makeMessage(20000)]
const fallback = await read('dense')
assert.equal(latestWire.suffixOnly, false)
assert.deepEqual(fallback.rawMessages, raw)
assert.deepEqual(fallback.transcriptCards, formatTranscriptCards(buildThreadedMessages(raw), 'dense'))
stripRequestToken = false

// ── Overlapping reads for one session serialize ────────────────────────────
// The worker handles each message in its own async task, so two reads for one
// session interleaved there: the second carried a baseline the first had
// already superseded, and the worker answered it with the WHOLE transcript
// rather than a suffix — correct, and exactly the cost the deltas exist to
// avoid. They now queue per key, and the second captures its baseline when it
// is posted rather than when it was asked for.
raw = [...raw, makeMessage(20001)]
requestsPosted = 0
const overlapped = await Promise.all([read(), read()])
assert.equal(requestsPosted, 2, 'both reads are answered')
// The wire is the evidence, not the timing: this harness answers a read in a
// microtask, so by any observable delay the queue has already drained. What
// distinguishes serialized from interleaved is what the SECOND read shipped.
// Racing the first, it carried a baseline the worker had already superseded and
// came back with complete arrays; queued behind it, it captures the baseline the
// first established and finds nothing left to send.
assert.equal((latestWire as { unchanged?: boolean }).unchanged, true,
  'a serialized second read captures a fresh baseline and ships nothing at all')
for (const result of overlapped) {
  assert.deepEqual(result.rawMessages, raw)
  assert.deepEqual(result.transcriptCards, formatTranscriptCards(buildThreadedMessages(raw)))
}

// A third read arriving while one is in flight replaces the one already
// waiting: they ask the same question of the same session, so the queued read
// would re-derive an answer nobody is waiting for any more.
raw = [...raw, makeMessage(20002)]
requestsPosted = 0
const superseded = await Promise.all([read(), read(), read()])
assert.equal(requestsPosted, 2, 'three overlapping reads collapse to two: one in flight, one latest')
for (const result of superseded) {
  assert.deepEqual(result.rawMessages, raw, 'a superseded caller still gets a correct transcript')
  assert.deepEqual(result.transcriptCards, formatTranscriptCards(buildThreadedMessages(raw)))
}
raw = []
const empty = await read()
assert.deepEqual(empty.rawMessages, [])
assert.deepEqual(empty.transcriptCards, [])
raw = [makeMessage(30000)]
const restarted = await read()
assert.deepEqual(restarted.rawMessages, raw)
await read('balanced', false)
assert.equal(latestWire.suffixOnly, false)
const old = [{ value: 1 }, { value: 2 }]
assert.equal(restoreDeliveredPrefix(old, [], 2, true), old)
assert.deepEqual(restoreDeliveredPrefix(old, [], 0, true), [])
assert.throws(() => restoreDeliveredPrefix(undefined, [], 1, true))

// Newest A is unchanged and reuses A's old delivery token. An older B source
// completes later; request ordering must remain independent from that token.
const raceSession = { provider: 'codex' as const, sessionId: 'detail-aba-order' }
raw = [makeMessage(40000), makeMessage(40001)]
const sourceA = [...raw]
await readAndBuildTranscriptAsync(raceSession, 'balanced', true)
raw = [makeMessage(50000)]
const sourceB = [...raw]
holdNextSource = true
const olderB = readAndBuildTranscriptAsync(raceSession, 'dense', true)
assert.ok(sourceGate.release)
raw = sourceA
const newestA = await readAndBuildTranscriptAsync(raceSession, 'balanced', true)
assert.equal((latestWire as { unchanged?: boolean }).unchanged, true)
sourceGate.release!()
delete sourceGate.release
const resultB = await olderB
assert.deepEqual(resultB.rawMessages, sourceB)
assert.deepEqual(resultB.transcriptCards, formatTranscriptCards(buildThreadedMessages(sourceB), 'dense'))
const retainedA = await readAndBuildTranscriptAsync(raceSession, 'balanced', true)
assert.deepEqual(retainedA.rawMessages, sourceA)
assert.equal((latestWire as { unchanged?: boolean }).unchanged, true)
assert.equal(retainedA.transcriptCards, newestA.transcriptCards)

// Format overlays use alternate-density tokens for input and sparse preview
// output; unchanged expanded data retains identity across the clone boundary.
const formatSession = { provider: 'codex' as const, sessionId: 'format-density-delivery' }
const formatRaw = Array.from({ length: 30 }, (_, i) => makeMessage(i))
const formatThreaded = buildThreadedMessages(formatRaw)
const format = (threaded = [...formatThreaded], density: 'balanced' | 'dense' | 'comfortable' = 'balanced', showTools = true) => formatTranscriptCardsAsync(formatSession, threaded, density, showTools)
const balancedCards = await format()
const denseCards = await format(undefined, 'dense')
assert.ok(latestWire.densityCards)
assert.deepEqual(denseCards, formatTranscriptCards(formatThreaded, 'dense'))
assert.equal(denseCards[0].expandedLines, balancedCards[0].expandedLines)
const comfortableCards = await format(undefined, 'comfortable')
assert.deepEqual(comfortableCards, formatTranscriptCards(formatThreaded, 'comfortable'))
assert.equal(comfortableCards[0].expandedLines, denseCards[0].expandedLines)
const firstEmpty = await format()
const nextEmpty = await format()
assert.equal(firstEmpty, nextEmpty)
assert.equal(latestWire.cardsPatch?.length, 0)
assert.deepEqual(await format(undefined, 'dense', false), formatTranscriptCards(stripToolCallBlocks(formatThreaded), 'dense'))
assert.deepEqual(await format(undefined, 'comfortable', false), formatTranscriptCards(stripToolCallBlocks(formatThreaded), 'comfortable'))

// A stale alternate token retries exactly once with full source.
const staleSession = { provider: 'codex' as const, sessionId: 'stale-density' }
await formatTranscriptCardsAsync(staleSession, formatThreaded, 'balanced', true)
stripFormatToken = true
requestsPosted = 0
const staleCards = await formatTranscriptCardsAsync(staleSession, [...formatThreaded], 'dense', true)
stripFormatToken = false
assert.equal(requestsPosted, 2)
assert.deepEqual(staleCards, formatTranscriptCards(formatThreaded, 'dense'))

// Evict just the worker's alternate baseline while client still owns it.
const evictedSession = { provider: 'codex' as const, sessionId: 'evicted-density' }
await formatTranscriptCardsAsync(evictedSession, formatThreaded, 'balanced', true)
for (let i = 0; i < 7; i++) await formatTranscriptCardsAsync({ provider: 'codex', sessionId: `density-evict-${i}` }, formatThreaded.slice(0, 2), 'balanced', true)
requestsPosted = 0
const recoveredCards = await formatTranscriptCardsAsync(evictedSession, [...formatThreaded], 'comfortable', true)
assert.equal(requestsPosted, 2)
assert.deepEqual(recoveredCards, formatTranscriptCards(formatThreaded, 'comfortable'))

// Different array keys run concurrently. Deliver newer format first and prove
// an old reply answers its own caller without overwriting newer sync cache.
const olderThreaded = [...formatThreaded]
const newerThreaded = buildThreadedMessages([...formatRaw, makeMessage(90001)])
deferResponses = true
const olderFormat = format(olderThreaded)
const newerFormat = format(newerThreaded)
// Handler formatting yields at its Mermaid preflight microtask.
for (let i = 0; i < 10; i++) await Promise.resolve()
assert.equal(responses.length, 2)
deferResponses = false
receiver!((responses.pop())!)
const newerResult = await newerFormat
receiver!((responses.pop())!)
const olderResult = await olderFormat
assert.deepEqual(olderResult, formatTranscriptCards(olderThreaded))
assert.deepEqual(newerResult, formatTranscriptCards(newerThreaded))
assert.equal(getTranscriptCardsSync(formatSession, newerThreaded, 'balanced', true), newerResult)
assert.equal(getTranscriptCardsSync(formatSession, olderThreaded, 'balanced', true), null)

// A late detail response likewise cannot replace fresher format cache content.
deferResponses = true
const lateDetail = read()
const freshFormat = formatTranscriptCardsAsync(session, newerThreaded, 'balanced', true)
for (let i = 0; i < 10; i++) await Promise.resolve()
assert.equal(responses.length, 2)
deferResponses = false
responses.sort((a, b) => b.data.id - a.data.id)
receiver!(responses.shift()!)
const freshCards = await freshFormat
receiver!(responses.shift()!)
await lateDetail
assert.equal(getTranscriptCardsSync(session, newerThreaded, 'balanced', true), freshCards)

const contextualSession = { provider: 'codex' as const, sessionId: 'density-context-refresh' }
const contextualRaw: SessionMessage[] = formatRaw.map((message, i) => ({ ...message, timestamp: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() }))
contextualRaw.push(
  { ...makeMessage(70000), type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'context-task-list', name: 'TaskList', input: {} }] } },
  { ...makeMessage(70001), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'context-task-list', content: '{"tasks":[{"id":"1","subject":"Check context","status":"in_progress"}]}' }] } },
)
await formatTranscriptCardsAsync(contextualSession, buildThreadedMessages(contextualRaw), 'balanced', true)
const updatedRaw: SessionMessage[] = contextualRaw.map((message, i) => i === 1 ? { ...message, timestamp: new Date(Date.UTC(2026, 0, 1) + 4000).toISOString() } : message)
updatedRaw.push(
  { ...makeMessage(70002), type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'context-task-update', name: 'TaskUpdate', input: { taskId: '1', activeForm: 'Checking new context' } }] } },
  { ...makeMessage(70003), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'context-task-update', content: '{"success":true,"taskId":"1","updatedFields":["activeForm"]}' }] } },
)
const updatedThreaded = buildThreadedMessages(updatedRaw)
for (const showTools of [true, false]) for (const density of ['dense', 'comfortable', 'balanced'] as const) {
  const cards = await formatTranscriptCardsAsync(contextualSession, [...updatedThreaded], density, showTools)
  assert.deepEqual(cards, formatTranscriptCards(showTools ? updatedThreaded : stripToolCallBlocks(updatedThreaded), density))
}

// Sparse responses require the exact captured token and valid shared indices.
for (const corrupt of ['token', 'index'] as const) {
  const corruptSession = { provider: 'codex' as const, sessionId: `invalid-density-${corrupt}` }
  await formatTranscriptCardsAsync(corruptSession, formatThreaded, 'balanced', true)
  deferResponses = true
  const invalid = formatTranscriptCardsAsync(corruptSession, [...formatThreaded], 'dense', true)
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.equal(responses.length, 1)
  const wire = responses.shift()!
  if (corrupt === 'token') wire.data.baseFormatToken = -1
  else wire.data.densityCards[0].sharedCardIndex = -1
  deferResponses = false
  receiver!(wire)
  await assert.rejects(invalid, /unknown density delta baseline/)
  // The worker advanced but the client rejected the response: retry the next
  // request from the old token, recover full input, and restore exact output.
  assert.deepEqual(await formatTranscriptCardsAsync(corruptSession, [...formatThreaded], 'dense', true), formatTranscriptCards(formatThreaded, 'dense'))
}
console.log(JSON.stringify({ benchmark: 'transcript-detail-delivery', messages: 10000, transfer, byteIdentical: true }))
