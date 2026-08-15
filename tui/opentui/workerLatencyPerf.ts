import { buildThreadedMessages } from '../../lib/threading'
import type { Session, SessionMessage } from '../../lib/types'
import { formatTranscriptCards } from '../format'
import { formatTranscriptCardsAsync } from './threadingWorkerClient'

const MESSAGE_COUNT = Number.parseInt(process.env.TUI_WORKER_PERF_MESSAGES ?? '10000', 10)
const RUNS = Math.max(3, Number.parseInt(process.env.TUI_WORKER_PERF_RUNS ?? '7', 10))
const SESSION_ID = 'worker-latency-perf'

function makeMessage(index: number): SessionMessage {
  const common = {
    uuid: `worker-perf-${index}`,
    session_id: SESSION_ID,
    parent_tool_use_id: null,
    timestamp: new Date(Date.UTC(2026, 0, 1) + index * 1_000).toISOString(),
    provider: 'codex' as const,
  }
  if (index % 2 === 0) {
    return {
      ...common,
      type: 'user',
      message: { role: 'user', content: `Inspect representative module ${index}.` },
    }
  }
  return {
    ...common,
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{
        type: 'text',
        text: `Module ${index} preserves ordering, card identity, and streaming output.`,
      }],
    },
  }
}

function makeTaskListMessages(index: number): SessionMessage[] {
  const toolId = `worker-perf-task-list-${index}`
  const common = {
    session_id: SESSION_ID,
    parent_tool_use_id: null,
    provider: 'codex' as const,
  }
  return [{
    ...common,
    uuid: `${toolId}-use`,
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: toolId, name: 'TaskList', input: {} }],
    },
  }, {
    ...common,
    uuid: `${toolId}-result`,
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolId,
        content: JSON.stringify({ tasks: [{ id: '1', subject: 'Verify fallback', status: 'in_progress' }] }),
      }],
    },
  }]
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  return sorted[index] ?? 0
}

function summarize(values: number[]) {
  return {
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  }
}

async function timed<T>(run: () => Promise<T>): Promise<{ durationMs: number; value: T }> {
  const startedAt = performance.now()
  const value = await run()
  return { durationMs: performance.now() - startedAt, value }
}

async function main(): Promise<void> {
  if (!Number.isInteger(MESSAGE_COUNT) || MESSAGE_COUNT <= 0) {
    throw new Error(`Invalid TUI_WORKER_PERF_MESSAGES: ${MESSAGE_COUNT}`)
  }

  const session = (suffix: string): Session => ({
    sessionId: `${SESSION_ID}-${suffix}`,
    provider: 'codex',
  })
  const rawMessages = Array.from({ length: MESSAGE_COUNT }, (_, index) => makeMessage(index))
  const threaded = buildThreadedMessages(rawMessages)

  // Pay worker startup/module loading outside the measured samples.
  await formatTranscriptCardsAsync(session('warmup'), threaded.slice(0, 100), 'balanced', true)

  const fullRoundTrips: number[] = []
  let firstWorkerCards = null as Awaited<ReturnType<typeof formatTranscriptCardsAsync>> | null
  for (let run = 0; run < RUNS; run += 1) {
    const sample = await timed(() => formatTranscriptCardsAsync(
      session(`full-${run}`),
      threaded,
      'balanced',
      true,
    ))
    fullRoundTrips.push(sample.durationMs)
    firstWorkerCards ??= sample.value
  }

  const streamingSession = session('streaming')
  await formatTranscriptCardsAsync(streamingSession, threaded, 'balanced', true)
  const streamingRoundTrips: number[] = []
  let streamingRaw = rawMessages
  let finalStreamingCards = firstWorkerCards!
  let finalStreamingThreaded = threaded
  for (let run = 0; run < RUNS; run += 1) {
    streamingRaw = [...streamingRaw, makeMessage(MESSAGE_COUNT + run)]
    finalStreamingThreaded = buildThreadedMessages(streamingRaw)
    const sample = await timed(() => formatTranscriptCardsAsync(
      streamingSession,
      finalStreamingThreaded,
      'balanced',
      true,
    ))
    streamingRoundTrips.push(sample.durationMs)
    finalStreamingCards = sample.value
  }

  const cachedRoundTrips: number[] = []
  for (let run = 0; run < RUNS; run += 1) {
    const sample = await timed(() => formatTranscriptCardsAsync(
      streamingSession,
      finalStreamingThreaded,
      'balanced',
      true,
    ))
    cachedRoundTrips.push(sample.durationMs)
  }

  const initialExpected = formatTranscriptCards(threaded)
  const streamingExpected = formatTranscriptCards(finalStreamingThreaded)

  const mutatedRaw = [...streamingRaw]
  mutatedRaw[10] = {
    ...mutatedRaw[10],
    message: { role: 'user', content: 'Mutated content must force a full-format fallback.' },
  }
  const mutatedThreaded = buildThreadedMessages(mutatedRaw)
  const mutatedCards = await formatTranscriptCardsAsync(
    streamingSession,
    mutatedThreaded,
    'balanced',
    true,
  )
  const truncatedRaw = mutatedRaw.slice(0, -3)
  const truncatedThreaded = buildThreadedMessages(truncatedRaw)
  const truncatedCards = await formatTranscriptCardsAsync(
    streamingSession,
    truncatedThreaded,
    'balanced',
    true,
  )
  const taskListThreaded = buildThreadedMessages([
    ...truncatedRaw,
    ...makeTaskListMessages(MESSAGE_COUNT + RUNS),
  ])
  const taskListCards = await formatTranscriptCardsAsync(
    streamingSession,
    taskListThreaded,
    'balanced',
    true,
  )
  const output = {
    schemaVersion: 1,
    benchmark: 'opentui-threading-worker-latency',
    configuration: { messageCount: MESSAGE_COUNT, runs: RUNS, streamingAppends: RUNS },
    latencyMs: {
      fullRoundTrip: summarize(fullRoundTrips),
      streamingAppendRoundTrip: summarize(streamingRoundTrips),
      mainThreadCacheHit: summarize(cachedRoundTrips),
    },
    correctness: {
      initialByteIdentical: JSON.stringify(firstWorkerCards) === JSON.stringify(initialExpected),
      streamingByteIdentical: JSON.stringify(finalStreamingCards) === JSON.stringify(streamingExpected),
      mutationFallbackByteIdentical: JSON.stringify(mutatedCards) === JSON.stringify(formatTranscriptCards(mutatedThreaded)),
      truncationFallbackByteIdentical: JSON.stringify(truncatedCards) === JSON.stringify(formatTranscriptCards(truncatedThreaded)),
      taskListFallbackByteIdentical: JSON.stringify(taskListCards) === JSON.stringify(formatTranscriptCards(taskListThreaded)),
      initialCardCount: firstWorkerCards!.length,
      streamingCardCount: finalStreamingCards.length,
    },
  }
  process.stdout.write(`${JSON.stringify(output)}\n`)
  process.exit(0)
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
