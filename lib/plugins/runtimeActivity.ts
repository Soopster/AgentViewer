import { isAgentProvider } from '../provider'
import { sessionIdentityKey } from '../sessionIdentity'
import type { PluginSessionActivity } from './application'
import { extractPendingPermissions, type PendingPermission } from '../permissions'

/** Normalize the shared runtime endpoint without conflating configured accounts. */
export function pluginRuntimeActivity(value: unknown): ReadonlyMap<string, PluginSessionActivity> {
  const result = new Map<string, PluginSessionActivity>()
  if (!value || typeof value !== 'object') throw new Error('Invalid runtime activity response')
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.running) || !Array.isArray(data.waiting) || !Array.isArray(data.attention)) throw new Error('Invalid runtime activity response')
  const keyOf = (row: unknown) => {
    if (!row || typeof row !== 'object') return null
    const entry = row as Record<string, unknown>
    return typeof entry.sessionId === 'string' && isAgentProvider(entry.provider)
      ? sessionIdentityKey({ sessionId: entry.sessionId, provider: entry.provider, providerInstanceId: typeof entry.providerInstanceId === 'string' ? entry.providerInstanceId : undefined }) : null
  }
  for (const row of data.running) {
    const key = keyOf(row)
    if (!key) continue
    const pending = (Array.isArray(row.pendingPrompts) && row.pendingPrompts.length > 0) || (Array.isArray(row.pendingPermissions) && row.pendingPermissions.length > 0)
    result.set(key, pending ? 'needs-input' : 'running')
  }
  for (const [rows, state] of [[data.waiting, 'waiting'], [data.attention, 'needs-input']] as const) {
    for (const row of rows) { const key = keyOf(row); if (key && !result.has(key)) result.set(key, state) }
  }
  return result
}

/** Unanswered asks per session from the same registry read, so a row can say what is being asked. */
export function pluginPendingAsks(value: unknown): ReadonlyMap<string, readonly PendingPermission[]> {
  const result = new Map<string, readonly PendingPermission[]>()
  const running = (value as { running?: unknown } | null)?.running
  if (!Array.isArray(running)) return result
  for (const row of running as Record<string, unknown>[]) {
    if (!row || typeof row.sessionId !== 'string' || !isAgentProvider(row.provider)) continue
    const key = sessionIdentityKey({ sessionId: row.sessionId, provider: row.provider, providerInstanceId: typeof row.providerInstanceId === 'string' ? row.providerInstanceId : undefined })
    const payloads = [...(Array.isArray(row.pendingPermissions) ? row.pendingPermissions : []), ...(Array.isArray(row.pendingPrompts) ? row.pendingPrompts : [])]
    const asks = extractPendingPermissions(payloads, { sessionId: row.sessionId, provider: row.provider })
    if (asks.length) result.set(key, asks)
  }
  return result
}
