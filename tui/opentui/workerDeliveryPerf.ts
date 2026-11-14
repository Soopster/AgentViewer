import assert from 'node:assert/strict'
// @ts-expect-error -- Bun-only per-VM diagnostics.
import { heapStats } from 'bun:jsc'
import { buildThreadedMessages } from '../../lib/threading'
import type { SessionMessage } from '../../lib/types'
import { formatTranscriptCards } from '../format'
import type { TuiDensity } from '../theme'

const count = Number(process.env.TUI_DELIVERY_MESSAGES ?? 2000)
const heapMode = process.env.TUI_DELIVERY_HEAP === '1'
const runs = Number(process.env.TUI_DELIVERY_RUNS ?? (heapMode ? 40 : 7))
const multipleDensities = process.env.TUI_DELIVERY_VARIANTS !== '0'
const NativeWorker = Worker
let request: unknown
let response: { workerHeap?: { heapSize: number }; [key: string]: unknown } | undefined
class ProfileWorker extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(heapMode ? new URL('./workerMemoryProbe.ts', import.meta.url).href : url, options)
    this.addEventListener('message', (event: MessageEvent) => { response = event.data })
  }
  postMessage(value: unknown): void { request = value; super.postMessage(value) }
}
Object.assign(globalThis, { Worker: ProfileWorker })
const { formatTranscriptCardsAsync } = await import('./threadingWorkerClient')
const gc = () => (globalThis as unknown as { Bun: { gc(sync: boolean): void } }).Bun.gc(true)
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] }
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const cold: number[] = [], density: number[] = [], empty: number[] = []
const transport: Record<string, { requestJsonBytes: number; responseJsonBytes: number }> = {}
let emptyCardsIdentityPreserved = false
const checkpoints: { sessions: number; callerHeapBytes: number; workerHeapBytes?: number }[] = []
let finalWorkerHeapBytes: number | undefined
const makeThreaded = (sessionId: string) => buildThreadedMessages(Array.from({ length: count }, (_, i): SessionMessage => ({
  uuid: `${sessionId}-${i}`, session_id: sessionId, type: i % 2 ? 'assistant' : 'user', parent_tool_use_id: null,
  timestamp: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
  message: { role: i % 2 ? 'assistant' : 'user', content: `Message ${i}\n${'representative transcript content '.repeat(12)}\nmore lines\npreview density\nlast line` },
})))
async function sample(sessionId: string, threaded: ReturnType<typeof buildThreadedMessages>, variant: TuiDensity, times: number[], label: string) {
  request = undefined; response = undefined
  const start = performance.now()
  const cards = await formatTranscriptCardsAsync({ sessionId, provider: 'codex' }, threaded, variant, true)
  times.push(performance.now() - start)
  transport[label] = { requestJsonBytes: bytes(request), responseJsonBytes: bytes(response) }
  assert.deepEqual(cards, formatTranscriptCards(threaded, variant))
  return cards
}
await formatTranscriptCardsAsync({ sessionId: 'delivery-warmup', provider: 'codex' }, makeThreaded('delivery-warmup').slice(0, 20), 'balanced', true)
gc()
const initialHeap = heapStats().heapSize
async function runSession(run: number): Promise<number | undefined> {
  const sessionId = `delivery-perf-${run}`
  const threaded = makeThreaded(sessionId)
  await sample(sessionId, threaded, 'balanced', cold, 'cold')
  if (multipleDensities) {
    await sample(sessionId, [...threaded], 'dense', density, 'density')
    await sample(sessionId, [...threaded], 'comfortable', density, 'density')
  }
  const first = await sample(sessionId, [...threaded], 'balanced', empty, 'empty')
  const next = await sample(sessionId, [...threaded], 'balanced', empty, 'empty')
  emptyCardsIdentityPreserved = first === next
  return response?.workerHeap?.heapSize
}
for (let run = 0; run < runs; run++) {
  const workerHeapBytes = await runSession(run)
  finalWorkerHeapBytes = workerHeapBytes
  request = undefined; response = undefined
  // Release the fixture/oracle and asynchronous event frames before collecting;
  // checkpoints measure only the cache working set, not the current sample.
  await new Promise<void>((resolve) => setImmediate(resolve))
  if (heapMode && [9, 19, 39].includes(run)) {
    gc()
    checkpoints.push({ sessions: run + 1, callerHeapBytes: heapStats().heapSize - initialHeap, workerHeapBytes })
  }
}
request = undefined; response = undefined
gc()
const retainedHeapBytes = heapStats().heapSize - initialHeap
console.log(JSON.stringify({ benchmark: 'worker-variant-delivery', count, runs, heapMode, multipleDensities,
  latencyMs: { cold: summarize(cold), density: summarize(density), empty: summarize(empty) },
  transport, emptyCardsIdentityPreserved, retainedHeapBytes, workerHeapBytes: finalWorkerHeapBytes, checkpoints, byteIdentical: true }))
if (checkpoints.length === 3) {
  assert.ok(checkpoints[2].callerHeapBytes - checkpoints[1].callerHeapBytes < 4 * 1024 * 1024, 'caller cache retention must plateau')
  assert.ok((checkpoints[2].workerHeapBytes ?? 0) - (checkpoints[1].workerHeapBytes ?? 0) < 4 * 1024 * 1024, 'worker cache retention must plateau')
}
process.exit(0)
