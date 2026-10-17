import type { ProtocolRunBudget, ProtocolUsageReceipt } from './agentProtocol'

export type CoordinatorResources = {
  maxAgents: number
  occupiedAgents: number
  budget?: ProtocolRunBudget
  usage: ProtocolUsageReceipt
  pausedReason: string | null
}

export function resourceLimits(fields: { capacity: string; tokens: string; cost: string; minutes: string }): { maxAgents: number; budget: ProtocolRunBudget } {
  const positive = (value: string, label: string, integer = false) => {
    if (!value.trim()) return undefined
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isSafeInteger(number))) throw new Error(`${label} must be a positive ${integer ? 'whole ' : ''}number`)
    return number
  }
  const maxAgents = positive(fields.capacity, 'Capacity', true)
  if (maxAgents === undefined || maxAgents < 2 || maxAgents > 16) throw new Error('Capacity must be between 2 and 16, including the lead')
  return { maxAgents, budget: { maxTokens: positive(fields.tokens, 'Token limit', true), maxCostUsd: positive(fields.cost, 'Cost limit'), maxDurationMinutes: positive(fields.minutes, 'Duration limit') } }
}

export function resourceSummary(resources: CoordinatorResources): string[] {
  return [
    `Capacity: ${resources.occupiedAgents}/${resources.maxAgents} agents including lead`,
    `Reported tokens: ${resources.usage.totalTokens === undefined ? 'unavailable' : resources.usage.totalTokens.toLocaleString()} · cost: ${resources.usage.costUsd === undefined ? 'unavailable' : `$${resources.usage.costUsd.toFixed(4)}`}`,
    'Usage can be partial when a provider has not reported it. Limits gate further scheduling; running turns may finish.',
    `Limits: ${resources.budget?.maxTokens ?? 'no'} tokens · ${resources.budget?.maxCostUsd === undefined ? 'no cost limit' : `$${resources.budget.maxCostUsd}`} · ${resources.budget?.maxDurationMinutes === undefined ? 'no time limit' : `${resources.budget.maxDurationMinutes} min since run creation`}`,
    ...(resources.pausedReason ? [`Scheduling paused: ${resources.pausedReason}`, 'Owned work is retained. Adjust the relevant limit to resume eligible work.'] : []),
  ]
}
