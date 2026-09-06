import assert from 'node:assert/strict'
// @ts-ignore -- Bun's test helpers are available to standalone smoke scripts.
import { mock } from 'bun:test'
// @ts-ignore -- Bun-only heap diagnostics.
import { heapStats } from 'bun:jsc'
import { buildThreadedMessages } from '../../lib/threading'
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
mock.module('../../lib/tui/reads', () => ({
  readTuiSessionDetailSource: async () => ({ info: null, rawMessages: structuredClone(raw) }),
  readTuiSessionMetadata: async () => ({}),
  readTuiSessions: async () => [],
}))

// Exercise the real worker handler and client together, including actual clone
// semantics, without provider SDKs or a user's session data.
type Wire = { id: number; suffixOnly?: boolean; rawMessages?: unknown[]; threadedMessages?: unknown[]; transcriptCards?: unknown[]; previousDeliveryToken?: number }
let latestWire: Wire = { id: 0 }
let stripRequestToken = false
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
class LocalWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror = null
  postMessage(data: Wire) {
    receiver = this.onmessage
    const request = structuredClone(data)
    if (stripRequestToken) delete request.previousDeliveryToken
    void workerScope.onmessage!({ data: request } as MessageEvent)
  }
  terminate() {}
}
Object.assign(globalThis, { Worker: LocalWorker })
const { readAndBuildTranscriptAsync } = await import('./threadingWorkerClient')
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
const simultaneous = await Promise.all([read(), read()])
for (const result of simultaneous) assert.deepEqual(result.rawMessages, raw)
raw = [...raw, makeMessage(20001)]
deferResponses = true
const firstPending = read()
const secondPending = read()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(responses.length, 2)
for (const event of responses.reverse()) receiver!(event)
deferResponses = false
for (const result of await Promise.all([firstPending, secondPending])) {
  assert.deepEqual(result.rawMessages, raw)
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
console.log(JSON.stringify({ benchmark: 'transcript-detail-delivery', messages: 10000, transfer, byteIdentical: true }))
