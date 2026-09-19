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

function makeTaskUpdateMessages(index: number): SessionMessage[] {
  const toolId = `worker-perf-task-update-${index}`
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
      content: [{
        type: 'tool_use',
        id: toolId,
        name: 'TaskUpdate',
        input: { taskId: '1', activeForm: `Verifying fallback ${index}` },
      }],
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
        content: JSON.stringify({ success: true, taskId: '1', updatedFields: ['activeForm'] }),
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

function checksum(value: unknown): string {
  const serialized = JSON.stringify(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < serialized.length; i++) {
    hash = Math.imul(hash ^ serialized.charCodeAt(i), 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
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

  const mutationSession = session('mutation')
  let mutatedRaw = [...streamingRaw]
  let mutatedThreaded = buildThreadedMessages(mutatedRaw)
  let mutatedCards = await formatTranscriptCardsAsync(mutationSession, mutatedThreaded, 'balanced', true)
  const mutationRoundTrips: number[] = []
  for (let run = 0; run < RUNS; run += 1) {
    mutatedRaw = [...mutatedRaw]
    const index = 10 + run * 2
    mutatedRaw[index] = {
      ...mutatedRaw[index],
      message: { role: 'user', content: `Mutated content ${run} must preserve byte-identical output.` },
    }
    mutatedThreaded = buildThreadedMessages(mutatedRaw)
    const sample = await timed(() => formatTranscriptCardsAsync(
      mutationSession,
      mutatedThreaded,
      'balanced',
      true,
    ))
    mutationRoundTrips.push(sample.durationMs)
    mutatedCards = sample.value
  }

  const truncationSession = session('truncation')
  await formatTranscriptCardsAsync(truncationSession, threaded, 'balanced', true)
  const truncationRoundTrips: number[] = []
  let truncatedRaw = rawMessages
  let truncatedThreaded = threaded
  let truncatedCards = firstWorkerCards!
  for (let run = 0; run < RUNS; run += 1) {
    truncatedRaw = rawMessages.slice(0, -(run + 1))
    truncatedThreaded = buildThreadedMessages(truncatedRaw)
    const sample = await timed(() => formatTranscriptCardsAsync(
      truncationSession,
      truncatedThreaded,
      'balanced',
      true,
    ))
    truncationRoundTrips.push(sample.durationMs)
    truncatedCards = sample.value
  }

  const taskListSession = session('task-list')
  let taskListRaw = [...rawMessages, ...makeTaskListMessages(MESSAGE_COUNT)]
  let taskListThreaded = buildThreadedMessages(taskListRaw)
  let taskListCards = await formatTranscriptCardsAsync(taskListSession, taskListThreaded, 'balanced', true)
  const taskListRoundTrips: number[] = []
  for (let run = 0; run < RUNS; run += 1) {
    taskListRaw = [...taskListRaw, ...makeTaskUpdateMessages(MESSAGE_COUNT + run)]
    taskListThreaded = buildThreadedMessages(taskListRaw)
    const sample = await timed(() => formatTranscriptCardsAsync(
      taskListSession,
      taskListThreaded,
      'balanced',
      true,
    ))
    taskListRoundTrips.push(sample.durationMs)
    taskListCards = sample.value
  }
  // Keep the client baseline warm while evicting it from the smaller worker
  // cache, then send a delta. The client must transparently resend full input.
  const evictionSession = session('eviction')
  await formatTranscriptCardsAsync(evictionSession, threaded, 'balanced', true)
  for (let i = 0; i < 7; i++) {
    await formatTranscriptCardsAsync(session(`evict-${i}`), threaded.slice(0, 20), 'balanced', true)
  }
  const evictionCards = await formatTranscriptCardsAsync(evictionSession, finalStreamingThreaded, 'balanced', true)
  const correctness = {
    evictionRecoveryByteIdentical: JSON.stringify(evictionCards) === JSON.stringify(streamingExpected),
    initialByteIdentical: JSON.stringify(firstWorkerCards) === JSON.stringify(initialExpected),
    streamingByteIdentical: JSON.stringify(finalStreamingCards) === JSON.stringify(streamingExpected),
    mutationFallbackByteIdentical: JSON.stringify(mutatedCards) === JSON.stringify(formatTranscriptCards(mutatedThreaded)),
    truncationFallbackByteIdentical: JSON.stringify(truncatedCards) === JSON.stringify(formatTranscriptCards(truncatedThreaded)),
    taskListFallbackByteIdentical: JSON.stringify(taskListCards) === JSON.stringify(formatTranscriptCards(taskListThreaded)),
  }
  const output = {
    schemaVersion: 1,
    benchmark: 'opentui-threading-worker-latency',
    configuration: { messageCount: MESSAGE_COUNT, runs: RUNS, streamingAppends: RUNS },
    latencyMs: {
      fullRoundTrip: summarize(fullRoundTrips),
      streamingAppendRoundTrip: summarize(streamingRoundTrips),
      mutationRoundTrip: summarize(mutationRoundTrips),
      truncationRoundTrip: summarize(truncationRoundTrips),
      taskListDependentRoundTrip: summarize(taskListRoundTrips),
      mainThreadCacheHit: summarize(cachedRoundTrips),
    },
    correctness: {
      ...correctness,
      checksums: {
        mutation: checksum(mutatedCards),
        mutationExpected: checksum(formatTranscriptCards(mutatedThreaded)),
        truncation: checksum(truncatedCards),
        truncationExpected: checksum(formatTranscriptCards(truncatedThreaded)),
        taskListDependent: checksum(taskListCards),
        taskListDependentExpected: checksum(formatTranscriptCards(taskListThreaded)),
      },
      initialCardCount: firstWorkerCards!.length,
      streamingCardCount: finalStreamingCards.length,
    },
  }
  process.stdout.write(`${JSON.stringify(output)}\n`)
  process.exit(Object.values(correctness).some((value) => !value) ? 1 : 0)
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
