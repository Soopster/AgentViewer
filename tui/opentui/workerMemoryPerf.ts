import assert from 'node:assert/strict'
import { buildThreadedMessages, stripToolCallBlocks } from '../../lib/threading'
import type { SessionMessage } from '../../lib/types'
import { formatTranscriptCards } from '../format'
import type { TuiDensity } from '../theme'

// Rotating sessions must plateau after cache warmup, including format-only
// sessions (live overlays use this path without a worker-side detail read).
const messageCount = Number(process.env.TUI_MEMORY_MESSAGES ?? 2000)
const sessionCount = 40
const worker = new Worker(new URL('./workerMemoryProbe.ts', import.meta.url).href)
type Reply = {
  ok: boolean
  error?: string
  transcriptCards: ReturnType<typeof formatTranscriptCards>
  workerHeap: { heapSize: number; objectCount: number }
}
let requestId = 0
async function format(index: number, density: TuiDensity = 'balanced', showToolCalls = true): Promise<Reply> {
  const raw: SessionMessage[] = Array.from({ length: messageCount }, (_, i) => ({
    uuid: `memory-${index}-${i}`, session_id: `memory-${index}`,
    type: i % 2 ? 'assistant' : 'user', parent_tool_use_id: null,
    message: { role: i % 2 ? 'assistant' : 'user', content: `Session ${index}, message ${i}: ${'representative transcript content '.repeat(8)}` },
  }))
  const threaded = buildThreadedMessages(raw)
  const reply = await new Promise<Reply>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker memory benchmark timed out')), 30000)
    worker.onmessage = (event: MessageEvent<Reply>) => { clearTimeout(timeout); resolve(event.data) }
    worker.onerror = (event) => { clearTimeout(timeout); reject(new Error(event.message)) }
    worker.postMessage({ kind: 'format', id: ++requestId, session: { provider: 'codex', sessionId: `memory-${index}` }, threaded, density, showToolCalls })
  })
  assert.equal(reply.ok, true, reply.error ?? 'Worker format failed')
  assert.deepEqual(reply.transcriptCards, formatTranscriptCards(showToolCalls ? threaded : stripToolCallBlocks(threaded), density))
  return reply
}

try {
  const checkpoints = []
  for (let i = 0; i < sessionCount; i++) {
    const reply = await format(i)
    if ([9, 19, 39].includes(i)) checkpoints.push({ sessions: i + 1, ...reply.workerHeap })
  }
  // Revisit an evicted session: full formatting must still be exact.
  await format(0)
  // Changing density replaces the single cached entry for each message.
  await format(0, 'dense')
  await format(0, 'comfortable')
  await format(0, 'balanced')
  await format(0, 'balanced', false)
  const growth = checkpoints[2].heapSize - checkpoints[1].heapSize
  console.log(JSON.stringify({ benchmark: 'opentui-worker-retention', messageCount, checkpoints, growthBytes: growth, byteIdentical: true }))
  assert.ok(growth < 4 * 1024 * 1024, `Worker retained ${(growth / 1048576).toFixed(1)} MiB across 20 additional sessions`)
} finally {
  worker.terminate()
}
