import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import type { Event as OpenCodeEvent } from '@opencode-ai/sdk'
import {
  enqueueOpenCodeHarnessEvent,
  type OpenCodeHarnessQueuedEvent,
} from '../lib/opencodeHarness'

const frames = 200
const deltasPerFrame = 250
const samples: number[] = []
let emittedEvents = 0

for (let frame = 0; frame < frames; frame += 1) {
  const queue: OpenCodeHarnessQueuedEvent[] = []
  const start = performance.now()
  for (let index = 0; index < deltasPerFrame; index += 1) {
    enqueueOpenCodeHarnessEvent(queue, {
      type: 'message.part.delta',
      properties: {
        sessionID: 'session',
        messageID: 'message',
        partID: 'part',
        field: 'text',
        delta: 'token ',
      },
    } as unknown as OpenCodeEvent, '/repo')
  }
  samples.push(performance.now() - start)
  emittedEvents += queue.length
  const merged = (queue[0]?.event as unknown as { properties?: { delta?: string } }).properties?.delta
  assert.equal(merged, 'token '.repeat(deltasPerFrame))
}

samples.sort((a, b) => a - b)
const inputEvents = frames * deltasPerFrame
const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0
const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0

assert.equal(emittedEvents, frames)
console.log(JSON.stringify({
  inputEvents,
  emittedEvents,
  reduction: inputEvents / emittedEvents,
  batchSize: deltasPerFrame,
  batchP50Ms: Number(p50.toFixed(3)),
  batchP95Ms: Number(p95.toFixed(3)),
}))
