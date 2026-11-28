import type { PluginIdeService } from '../../lib/plugins/openInIde'
async function request<T>(method: 'GET' | 'POST', body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/ide', { method, signal, ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'IDE request failed')
  return data.result
}
export const webIde: PluginIdeService = {
  read: signal => request('GET', undefined, signal),
  setPreference: ide => request('POST', { action: 'set', ide }),
  open: input => request('POST', { action: 'open', ...input }),
}
