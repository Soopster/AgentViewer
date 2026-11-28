import type { SecondOpinionService } from '../../lib/plugins/secondOpinion'
async function request<T>(method: 'GET' | 'POST', body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(method === 'GET' ? `/api/second-opinion?${new URLSearchParams(body as Record<string, string>)}` : '/api/second-opinion', {
    method, signal, ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Second Opinion request failed')
  return data.result
}
export const webSecondOpinion: SecondOpinionService = {
  read: (cwd, signal) => request('GET', { cwd }, signal),
  start: (cwd, input) => request('POST', { cwd, action: 'start', ...input }),
  cancel: (cwd, id) => request('POST', { cwd, action: 'cancel', id }),
  dismiss: (cwd, id, findingId) => request('POST', { cwd, action: 'dismiss', id, findingId }),
  configure: (cwd, settings) => request('POST', { cwd, action: 'configure', settings }),
}
