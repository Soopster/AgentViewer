import type { FocusService } from '../../lib/plugins/focusMode'
async function request<T>(method: 'GET' | 'POST', body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/focus', { method, signal, ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Focus request failed')
  return data.result
}
export const webFocus: FocusService = {
  read: signal => request('GET', undefined, signal),
  start: minutes => request('POST', { action: 'start', minutes }),
  end: () => request('POST', { action: 'end' }),
  hold: items => request('POST', { action: 'hold', items }),
  clearDigest: () => request('POST', { action: 'clear-digest' }),
}
