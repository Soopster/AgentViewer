import type { AgentProvider } from './types'

export type ComposerBenchmarkSummary = {
  type: 'summary'
  surface: 'agentviewer' | 'native-cli'
  provider: AgentProvider
  runs: number
  successes: number
  failures: number
  firstEventP95Ms: number | null
  completionP95Ms: number | null
  ackP95Ms?: number | null
}

export type ComposerBenchmarkThresholds = {
  firstEventRatio: number
  firstEventSlackMs: number
  completionRatio: number
  completionSlackMs: number
}

export type ComposerBenchmarkComparison = {
  provider: AgentProvider
  passed: boolean
  agentViewerSuccessRate: number
  nativeSuccessRate: number
  firstEventLimitMs: number
  completionLimitMs: number
  firstEventP95Ms: number
  nativeFirstEventP95Ms: number
  completionP95Ms: number
  nativeCompletionP95Ms: number
  reasons: string[]
}

export const DEFAULT_COMPOSER_BENCHMARK_THRESHOLDS: ComposerBenchmarkThresholds = {
  firstEventRatio: 1.15,
  firstEventSlackMs: 50,
  completionRatio: 1.1,
  completionSlackMs: 100,
}

function isFiniteMetric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function parseComposerBenchmarkSummaries(text: string): ComposerBenchmarkSummary[] {
  return text.split(/\r?\n/).flatMap((line): ComposerBenchmarkSummary[] => {
    if (!line.trim().startsWith('{')) return []
    try {
      const value = JSON.parse(line) as Partial<ComposerBenchmarkSummary>
      if (value.type !== 'summary') return []
      if (value.surface !== 'agentviewer' && value.surface !== 'native-cli') return []
      if (!['claude', 'codex', 'opencode', 'copilot', 'pi'].includes(value.provider ?? '')) return []
      if (!Number.isInteger(value.runs) || !Number.isInteger(value.successes) || !Number.isInteger(value.failures)) return []
      return [value as ComposerBenchmarkSummary]
    } catch {
      return []
    }
  })
}

export function compareComposerBenchmarks(
  agentViewer: ComposerBenchmarkSummary[],
  native: ComposerBenchmarkSummary[],
  thresholds: ComposerBenchmarkThresholds = DEFAULT_COMPOSER_BENCHMARK_THRESHOLDS,
): ComposerBenchmarkComparison[] {
  const agentViewerByProvider = new Map(agentViewer.map((summary) => [summary.provider, summary]))
  const nativeByProvider = new Map(native.map((summary) => [summary.provider, summary]))
  const providers = [...new Set([...agentViewerByProvider.keys(), ...nativeByProvider.keys()])].sort()
  if (providers.length === 0) throw new Error('No benchmark summaries found')

  return providers.map((provider) => {
    const viewer = agentViewerByProvider.get(provider)
    const baseline = nativeByProvider.get(provider)
    if (!viewer || !baseline) throw new Error(`Missing ${!viewer ? 'AgentViewer' : 'native CLI'} summary for ${provider}`)
    if (viewer.surface !== 'agentviewer') throw new Error(`Expected AgentViewer summary for ${provider}`)
    if (baseline.surface !== 'native-cli') throw new Error(`Expected native CLI summary for ${provider}`)
    if (viewer.runs <= 0 || baseline.runs <= 0) throw new Error(`Benchmark runs must be positive for ${provider}`)
    if (viewer.successes + viewer.failures !== viewer.runs || baseline.successes + baseline.failures !== baseline.runs) {
      throw new Error(`Benchmark success/failure counts do not match runs for ${provider}`)
    }
    if (!isFiniteMetric(viewer.firstEventP95Ms) || !isFiniteMetric(baseline.firstEventP95Ms)) {
      throw new Error(`Missing first-event p95 for ${provider}`)
    }
    if (!isFiniteMetric(viewer.completionP95Ms) || !isFiniteMetric(baseline.completionP95Ms)) {
      throw new Error(`Missing completion p95 for ${provider}`)
    }

    const agentViewerSuccessRate = viewer.successes / viewer.runs
    const nativeSuccessRate = baseline.successes / baseline.runs
    const firstEventLimitMs = baseline.firstEventP95Ms * thresholds.firstEventRatio + thresholds.firstEventSlackMs
    const completionLimitMs = baseline.completionP95Ms * thresholds.completionRatio + thresholds.completionSlackMs
    const reasons: string[] = []
    if (agentViewerSuccessRate < nativeSuccessRate) {
      reasons.push(`success rate ${(agentViewerSuccessRate * 100).toFixed(1)}% is below native ${(nativeSuccessRate * 100).toFixed(1)}%`)
    }
    if (viewer.firstEventP95Ms > firstEventLimitMs) {
      reasons.push(`first-event p95 ${viewer.firstEventP95Ms.toFixed(1)}ms exceeds ${firstEventLimitMs.toFixed(1)}ms parity limit`)
    }
    if (viewer.completionP95Ms > completionLimitMs) {
      reasons.push(`completion p95 ${viewer.completionP95Ms.toFixed(1)}ms exceeds ${completionLimitMs.toFixed(1)}ms parity limit`)
    }
    return {
      provider,
      passed: reasons.length === 0,
      agentViewerSuccessRate,
      nativeSuccessRate,
      firstEventLimitMs,
      completionLimitMs,
      firstEventP95Ms: viewer.firstEventP95Ms,
      nativeFirstEventP95Ms: baseline.firstEventP95Ms,
      completionP95Ms: viewer.completionP95Ms,
      nativeCompletionP95Ms: baseline.completionP95Ms,
      reasons,
    }
  })
}

/**
 * "First event" only means something if both benchmark surfaces agree on what
 * counts as one. Each turn opens with plumbing — SSE control frames, provider
 * session/init envelopes, hook lifecycle lines, command queue/start
 * notifications — that lands in single-digit milliseconds and says nothing
 * about how fast the model started answering. Counting any of it makes the
 * measured surface look arbitrarily fast, so the two benchmarks share these
 * predicates rather than each keeping their own drifting copy.
 */

/** SSE `event:` names the server uses for turn control rather than model output. */
export const BENCHMARK_CONTROL_EVENTS: ReadonlySet<string> = new Set([
  'heartbeat',
  'session',
  'context-usage',
  'turn-usage',
  'turn-accepted',
  'turn-notice',
  'command-result',
  'merged',
  'opencode-status',
  'opencode-todos',
])

/** Provider envelope `type`s that announce a turn rather than carry its output. */
export const BENCHMARK_STARTUP_PAYLOAD_TYPES: ReadonlySet<string> = new Set([
  'system',
  'session',
  'thread.started',
  'command_lifecycle',
  'pi_status',
])

/** True when a JSON payload line is turn plumbing rather than model output. */
export function isBenchmarkStartupPayload(rawJson: string): boolean {
  const trimmed = rawJson.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    return BENCHMARK_STARTUP_PAYLOAD_TYPES.has(String((JSON.parse(trimmed) as { type?: unknown }).type))
  } catch {
    return false
  }
}
