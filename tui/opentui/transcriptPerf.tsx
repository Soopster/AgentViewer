import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildThreadedMessages } from '../../lib/threading'
import type { ContentBlock, SessionMessage } from '../../lib/types'
import { formatTranscriptCards } from '../format'

type MemorySnapshot = ReturnType<typeof process.memoryUsage>

type Scenario = {
  messageCount: number
  splitPanes: number
}

type Sample = {
  durationMs: number
  threadingDurationMs: number
  formattingDurationMs: number
  peakHeapTotalDeltaBytes: number
  peakHeapUsedDeltaBytes: number
  peakRssDeltaBytes: number
  postGcHeapTotalBytes: number
  postGcHeapUsedBytes: number
  postGcRssBytes: number
  postGcHeapTotalDeltaBytes: number
  postGcHeapUsedDeltaBytes: number
  postGcRssDeltaBytes: number
  checksum: number
}

const DEFAULT_MESSAGE_COUNTS = [100, 1_000, 10_000]
const SPLIT_PANE_COUNTS = [0, 1, 2]
const SESSION_ID = 'tui-perf-session'
const FIXED_TIMESTAMP_MS = Date.UTC(2026, 0, 1)

function envPositiveInt(name: string): number | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function makeMessage(index: number): SessionMessage {
  const timestamp = new Date(FIXED_TIMESTAMP_MS + index * 1_000).toISOString()
  const common = {
    uuid: `perf-${index}`,
    session_id: SESSION_ID,
    parent_tool_use_id: null,
    timestamp,
    provider: 'codex' as const,
  }

  switch (index % 5) {
    case 0:
      return {
        ...common,
        type: 'user',
        message: {
          role: 'user',
          content: `Review module ${index} and preserve observable transcript behavior.`,
        },
      }
    case 1:
      return {
        ...common,
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: `I inspected module ${index}. The hot path repeats normalization and search indexing for every visible card.`,
          }],
          usage: {
            input_tokens: 800 + index,
            output_tokens: 120 + (index % 80),
            cache_read_input_tokens: index % 3 === 0 ? 400 : 0,
          },
        },
      }
    case 2: {
      const toolId = `tool-${index}`
      const content: ContentBlock[] = [
        { type: 'text', text: `Checking the representative source path for sample ${index}.` },
        {
          type: 'tool_use',
          id: toolId,
          name: index % 10 === 2 ? 'Read' : 'Bash',
          input: index % 10 === 2
            ? { file_path: `tui/example-${index % 17}.ts`, offset: 1, limit: 120 }
            : { command: `rg -n "sample-${index}" tui lib` },
        },
      ]
      return {
        ...common,
        type: 'assistant',
        message: { role: 'assistant', content },
      }
    }
    case 3:
      return {
        ...common,
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: `tool-${index - 1}`,
            content: `tui/example-${index % 17}.ts:${index}: representative output\n${'result '.repeat(8)}`,
          }],
        },
      }
    default:
      return {
        ...common,
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'thinking',
            thinking: `Compare the current result with the previous sample and retain stable ordering for ${index}.`,
          }, {
            type: 'text',
            text: `The result for sample ${index} is stable.\n\n- preserves ordering\n- keeps tool output paired\n- avoids layout changes`,
          }],
        },
      }
  }
}

function forceGc(): boolean {
  const gc = (globalThis as { gc?: () => void }).gc
  if (typeof gc === 'function') {
    gc()
    return true
  }
  const bunGc = (globalThis as { Bun?: { gc?: (force?: boolean) => void } }).Bun?.gc
  if (typeof bunGc === 'function') {
    bunGc(true)
    return true
  }
  return false
}

function delta(current: number, baseline: number): number {
  return Math.max(0, current - baseline)
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  return sorted[index] ?? 0
}

function executeScenario(rawMessages: SessionMessage[], splitPanes: number): {
  durationMs: number
  threadingDurationMs: number
  formattingDurationMs: number
  peak: MemorySnapshot
  checksum: number
} {
  const startedAt = performance.now()
  const threaded = buildThreadedMessages(rawMessages)
  const threadedAt = performance.now()
  let checksum = threaded.length
  const renderedViews = []

  for (let view = 0; view <= splitPanes; view += 1) {
    // Split panes render bounded transcript tails. Offset each view slightly so
    // the benchmark exercises distinct array identities like separate sessions.
    const tailLength = Math.min(threaded.length, 2_000 + view * 137)
    const viewMessages = view === 0
      ? threaded
      : threaded.slice(Math.max(0, threaded.length - tailLength))
    const cards = formatTranscriptCards(viewMessages)
    renderedViews.push(cards)
    checksum += cards.length
    checksum += cards[0]?.searchHaystackLower.length ?? 0
    checksum += cards.at(-1)?.expandedLines.length ?? 0
  }

  const durationMs = performance.now() - startedAt
  const threadingDurationMs = threadedAt - startedAt
  const formattingDurationMs = durationMs - threadingDurationMs
  // Keep all mounted-view card arrays reachable until the memory snapshot.
  // This distinguishes peak live allocations from the post-GC retained sample.
  checksum += renderedViews.length
  return { durationMs, threadingDurationMs, formattingDurationMs, peak: process.memoryUsage(), checksum }
}

function runSample(rawMessages: SessionMessage[], splitPanes: number): Sample {
  forceGc()
  const before = process.memoryUsage()
  const { durationMs, threadingDurationMs, formattingDurationMs, peak, checksum } = executeScenario(rawMessages, splitPanes)
  forceGc()
  const retained = process.memoryUsage()
  return {
    durationMs,
    threadingDurationMs,
    formattingDurationMs,
    peakHeapTotalDeltaBytes: delta(peak.heapTotal, before.heapTotal),
    peakHeapUsedDeltaBytes: delta(peak.heapUsed, before.heapUsed),
    peakRssDeltaBytes: delta(peak.rss, before.rss),
    postGcHeapTotalBytes: retained.heapTotal,
    postGcHeapUsedBytes: retained.heapUsed,
    postGcRssBytes: retained.rss,
    postGcHeapTotalDeltaBytes: delta(retained.heapTotal, before.heapTotal),
    postGcHeapUsedDeltaBytes: delta(retained.heapUsed, before.heapUsed),
    postGcRssDeltaBytes: delta(retained.rss, before.rss),
    checksum,
  }
}

function iterationCount(messageCount: number): number {
  const override = envPositiveInt('TUI_PERF_RUNS')
  if (override) return override
  if (messageCount >= 10_000) return 5
  if (messageCount >= 1_000) return 10
  return 20
}

function warmupCount(messageCount: number): number {
  if (messageCount >= 10_000) return 1
  if (messageCount >= 1_000) return 2
  return 3
}

function summarize(scenario: Scenario, samples: Sample[]) {
  const metric = (key: Exclude<keyof Sample, 'checksum'>) => {
    const values = samples.map((sample) => sample[key])
    return {
      median: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      max: Math.max(...values),
    }
  }

  return {
    ...scenario,
    views: scenario.splitPanes + 1,
    runs: samples.length,
    durationMs: metric('durationMs'),
    threadingDurationMs: metric('threadingDurationMs'),
    formattingDurationMs: metric('formattingDurationMs'),
    peakHeapTotalDeltaBytes: metric('peakHeapTotalDeltaBytes'),
    peakHeapUsedDeltaBytes: metric('peakHeapUsedDeltaBytes'),
    peakRssDeltaBytes: metric('peakRssDeltaBytes'),
    postGcHeapTotalBytes: metric('postGcHeapTotalBytes'),
    postGcHeapUsedBytes: metric('postGcHeapUsedBytes'),
    postGcRssBytes: metric('postGcRssBytes'),
    postGcHeapTotalDeltaBytes: metric('postGcHeapTotalDeltaBytes'),
    postGcHeapUsedDeltaBytes: metric('postGcHeapUsedDeltaBytes'),
    postGcRssDeltaBytes: metric('postGcRssDeltaBytes'),
    checksum: samples[0]?.checksum ?? 0,
  }
}

function runScenario(scenario: Scenario) {
  const rawMessages = Array.from({ length: scenario.messageCount }, (_, index) => makeMessage(index))
  const warmups = warmupCount(scenario.messageCount)
  for (let run = 0; run < warmups; run += 1) executeScenario(rawMessages, scenario.splitPanes)
  const samples = Array.from(
    { length: iterationCount(scenario.messageCount) },
    () => runSample(rawMessages, scenario.splitPanes),
  )
  return summarize(scenario, samples)
}

function childScenario(): Scenario | null {
  const argument = process.argv.find((value) => value.startsWith('--scenario='))
  if (!argument) return null
  const [messageCount, splitPanes] = argument.slice('--scenario='.length).split(',').map(Number)
  if (!Number.isInteger(messageCount) || messageCount <= 0 || !SPLIT_PANE_COUNTS.includes(splitPanes)) {
    throw new Error(`Invalid scenario argument: ${argument}`)
  }
  return { messageCount, splitPanes }
}

function main() {
  const child = childScenario()
  if (child) {
    process.stdout.write(`${JSON.stringify(runScenario(child))}\n`)
    return
  }

  const messageCounts = process.env.TUI_PERF_MESSAGES
    ?.split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0)
  const counts = messageCounts?.length ? messageCounts : DEFAULT_MESSAGE_COUNTS
  const gcAvailable = forceGc()
  const scenarios = counts.flatMap((messageCount) => (
    SPLIT_PANE_COUNTS.map((splitPanes) => ({ messageCount, splitPanes }))
  ))

  const scriptPath = fileURLToPath(import.meta.url)
  const results = scenarios.map((scenario) => {
    const childResult = spawnSync(
      process.execPath,
      ['--expose-gc', 'run', scriptPath, `--scenario=${scenario.messageCount},${scenario.splitPanes}`],
      { encoding: 'utf8', env: process.env },
    )
    if (childResult.status !== 0) {
      throw new Error(`Scenario ${scenario.messageCount}/${scenario.splitPanes} failed: ${childResult.stderr}`)
    }
    return JSON.parse(childResult.stdout.trim()) as ReturnType<typeof summarize>
  })

  const output = {
    schemaVersion: 1,
    benchmark: 'opentui-transcript-pipeline',
    invocation: 'npm run tui:perf',
    generatedAt: new Date().toISOString(),
    environment: {
      runtime: 'bun',
      bunVersion: (globalThis as { Bun?: { version?: string } }).Bun?.version ?? null,
      nodeCompatVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : null,
      gcAvailable,
    },
    configuration: {
      messageCounts: counts,
      splitPaneCounts: SPLIT_PANE_COUNTS,
      warmupRuns: Object.fromEntries(counts.map((count) => [count, warmupCount(count)])),
      measuredRuns: Object.fromEntries(counts.map((count) => [count, iterationCount(count)])),
      splitPaneTailCardBudget: 2_000,
      notes: [
        'each scenario runs in an isolated child process so allocator retention does not leak across scenarios',
        'duration includes threading plus transcript-card formatting for the primary view and each split-pane equivalent',
        'peak delta metrics are sampled before formatted cards become collectible and relative to the post-warmup baseline',
        'post-GC metrics include absolute memory and retained deltas after each scenario result becomes collectible',
        'heapTotal is reported because Bun 1.3.14 heapUsed may remain unchanged across JavaScript allocations',
        'RSS may remain reserved by the runtime allocator after garbage collection',
      ],
    },
    results,
  }

  process.stdout.write(`${JSON.stringify(output)}\n`)
}

main()
