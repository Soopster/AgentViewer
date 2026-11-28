import { currentProviderInstanceId } from './providerInstances'
import type { SubagentSummary } from './types'
import { scrubCardText } from './plugins/cardBlocks'

type Entry = SubagentSummary & { childSessionId?: string; sessionFile?: string }
const live = new Map<string, Map<string, Entry[]>>()
const states = new Set(['queued', 'pending', 'running', 'completed', 'failed', 'paused', 'stopped', 'cancelled', 'timeout', 'timed_out'])
const record = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const str = (value: unknown) => typeof value === 'string' ? scrubCardText(value, 180).replace(/\s+/g, ' ').trim() : ''
const tokenCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w.-]{1,120}$/.test(value)

export function piSubagentRows(callId: string, details: unknown, defaultStatus?: string): Entry[] {
  const data = record(details)
  const rows = [data.workflowChildren, data.results, data.progress, data.runs].find((value): value is unknown[] => Array.isArray(value) && value.length > 0) ?? [data]
  return rows.slice(0, 50).flatMap((value, index) => {
    const row = record(value)
    const runId = [row.runId, row.id, data.runId].find(validId)
    const childSessionId = validId(row.sessionId) ? row.sessionId : undefined
    const candidate = row.status ?? row.state ?? record(row.progress).status ?? data.state ?? (typeof row.exitCode === 'number' ? (row.exitCode === 0 ? 'completed' : 'failed') : defaultStatus)
    const status = typeof candidate === 'string' && states.has(candidate) ? candidate : undefined
    const label = str(row.task) || str(row.agent) || str(data.agent)
    if (!runId && !childSessionId && !label) return []
    const usage = record(row.usage)
    return [{
      agentId: `pi-run:${runId ?? callId}:${Number.isSafeInteger(row.index) ? row.index : index}`,
      taskDescription: label || 'Pi subagent',
      childSessionId,
      sessionFile: typeof row.sessionFile === 'string' && row.sessionFile.length <= 4096 ? row.sessionFile : undefined,
      status,
      provider: 'pi' as const,
      messageCount: 0,
      usage: { inputTokens: tokenCount(usage.input), outputTokens: tokenCount(usage.output), cacheReadTokens: tokenCount(usage.cacheRead), totalTokens: typeof row.totalTokens === 'number' ? tokenCount(row.totalTokens) : undefined },
    }]
  })
}

export function recordPiSubagentProgress(sessionId: string, callId: string, details: unknown, final?: boolean, failed?: boolean) {
  const key = JSON.stringify([currentProviderInstanceId('pi'), sessionId])
  const rows = piSubagentRows(callId, details, final ? (failed ? 'failed' : undefined) : 'running')
  if (!rows.length) return
  const calls = live.get(key) ?? new Map<string, Entry[]>()
  calls.set(callId, rows)
  while (calls.size > 40) calls.delete(calls.keys().next().value!)
  live.set(key, calls)
  while (live.size > 40) live.delete(live.keys().next().value!)
}

export function readPiSubagentProgress(sessionId: string): Entry[] {
  return [...(live.get(JSON.stringify([currentProviderInstanceId('pi'), sessionId]))?.values() ?? [])].flat()
}
