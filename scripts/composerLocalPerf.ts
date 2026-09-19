import assert from 'node:assert/strict'

import { deliverComposerSteer } from '../lib/composerSteering'
import {
  clearRunningSession,
  setRunningSession,
  steerRunningSessionIdempotent,
} from '../lib/sessionRuntime'
import { WebComposerQueueStore } from '../lib/webComposerQueue'

type Entry = { id: string; text: string }
type Metric = { name: string; runs: number; p50Ms: number; p95Ms: number; budgetMs: number }

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!
}

async function measure(
  name: string,
  runs: number,
  budgetMs: number,
  operation: (run: number) => void | Promise<void>,
): Promise<Metric> {
  for (let run = 0; run < Math.min(20, runs); run += 1) await operation(-run - 1)
  const samples: number[] = []
  for (let run = 0; run < runs; run += 1) {
    const startedAt = performance.now()
    await operation(run)
    samples.push(performance.now() - startedAt)
  }
  const metric = {
    name,
    runs,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    budgetMs,
  }
  console.log(JSON.stringify({ type: 'composer-local-perf', ...metric }))
  assert.ok(metric.p95Ms < budgetMs, `${name} p95 ${metric.p95Ms.toFixed(3)}ms exceeded ${budgetMs}ms budget`)
  return metric
}

const sessionId = 'composer-local-perf'
let providerSteers = 0
setRunningSession(sessionId, {
  provider: 'codex',
  requestId: 'perf-turn',
  interrupt: async () => {},
  steer: async () => {
    providerSteers += 1
    return `steer-${providerSteers}`
  },
})

await measure('steer-receipt-create', 500, 16, async (run) => {
  const result = await steerRunningSessionIdempotent(
    sessionId,
    `follow-up ${run}`,
    'perf-turn',
    `perf-steer-${run}`,
  )
  assert.equal(result.delivered, true)
})

const cachedSteerId = 'perf-steer-cached'
await steerRunningSessionIdempotent(sessionId, 'cached follow-up', 'perf-turn', cachedSteerId)
const providerSteersBeforeCacheHits = providerSteers
await measure('steer-receipt-cache-hit', 2_000, 16, async () => {
  const result = await steerRunningSessionIdempotent(sessionId, 'cached follow-up', 'perf-turn', cachedSteerId)
  assert.equal(result.delivered, true)
})
assert.equal(providerSteers, providerSteersBeforeCacheHits, 'cached steer receipts must bypass provider I/O')

await measure('ambiguous-steer-retry', 500, 16, async (run) => {
  let attempts = 0
  const providerSteersBeforeRetry = providerSteers
  const result = await deliverComposerSteer(async (payload) => {
    attempts += 1
    const delivered = await steerRunningSessionIdempotent(
      sessionId,
      payload.message,
      payload.turnRequestId,
      payload.steerRequestId,
    )
    if (attempts === 1) throw new Error('synthetic lost response')
    return delivered
  }, {
    message: `retry ${run}`,
    provider: 'codex',
    turnRequestId: 'perf-turn',
  })
  assert.equal(result.delivered, true)
  assert.equal(attempts, 2)
  assert.equal(providerSteers, providerSteersBeforeRetry + 1, 'transport retry must invoke the provider once')
})

clearRunningSession(sessionId, 'perf-turn')

const storage = new MemoryStorage()
let revisionTime = 10_000
const queueStore = new WebComposerQueueStore<Entry>({
  isEntry: (value): value is Entry => Boolean(
    value
    && typeof value === 'object'
    && typeof (value as Partial<Entry>).id === 'string'
    && typeof (value as Partial<Entry>).text === 'string',
  ),
  getEntryId: (entry) => entry.id,
  localStorage: storage,
  shouldInline: () => true,
  now: () => revisionTime++,
  origin: 'perf',
})

const largeText = 'x'.repeat(256 * 1024)
await measure('queue-commit-256kb', 100, 16, (run) => {
  const commit = queueStore.commit([{ id: `large-${run}`, text: largeText }])
  assert.equal(commit.durability, 'durable')
})

await measure('queue-claim-100-items', 500, 16, async (run) => {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    id: `claim-${run}-${index}`,
    text: `queued ${index}`,
  }))
  queueStore.commit(entries)
  const claim = await queueStore.claim('codex:perf', entries[0]!.id)
  assert.equal(claim.claimed, true)
  assert.equal(claim.entries.length, 99)
})

console.log('Composer local hot-path latency budgets passed')
