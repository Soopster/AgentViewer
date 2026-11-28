import type { ProtocolUsageReceipt } from './agentProtocol'
import type { CodexThreadTokenUsage } from './codexProtocol'

type Breakdown = CodexThreadTokenUsage['total']
type Spend = Required<Pick<ProtocolUsageReceipt, 'totalTokens' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens'>>
  & Pick<ProtocolUsageReceipt, 'cacheWriteTokens'>
const counters = ['totalTokens', 'inputTokens', 'outputTokens', 'cachedInputTokens'] as const
const validCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function validBreakdown(value: Breakdown | undefined): value is Breakdown {
  return Boolean(value && counters.every(key => validCount(value[key])))
}

export function createCodexTurnSpend(baseline?: Breakdown) {
  let previous = validBreakdown(baseline) ? baseline : undefined
  let partial = false
  let usage: Spend | undefined
  return {
    observe(report: CodexThreadTokenUsage) {
      const total = report.total
      if (!validBreakdown(total)) {
        partial = true
        return
      }
      const prior = previous
      previous = total
      const continuous = prior && counters.every(key => total[key] >= prior[key])
      // The first snapshot of a cold or reset thread can include older turns.
      // Count the latest observed request and mark the turn as partial.
      const last = report.last
      if (!continuous) partial = true
      if (!continuous && !validBreakdown(last)) return
      const delta = (key: typeof counters[number]) => continuous ? total[key] - prior[key] : last[key]
      const totalTokens = delta('totalTokens')
      if (!totalTokens) return
      usage ??= { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
      const cached = delta('cachedInputTokens')
      usage.totalTokens += totalTokens
      usage.inputTokens += Math.max(0, delta('inputTokens') - cached)
      usage.outputTokens += delta('outputTokens')
      usage.cacheReadTokens += cached
      const cacheWrite = continuous
        ? validCount(total.cacheWriteInputTokens) && validCount(prior.cacheWriteInputTokens)
          ? total.cacheWriteInputTokens - prior.cacheWriteInputTokens
          : undefined
        : last.cacheWriteInputTokens
      if (validCount(cacheWrite)) usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + cacheWrite
    },
    result() {
      return usage ? { usage: { ...usage }, partial } : undefined
    },
  }
}
