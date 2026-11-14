import type { ProofService } from '../../lib/plugins/proof'
async function request<T>(method: 'GET' | 'POST', body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(method === 'GET' ? `/api/proof?${new URLSearchParams(body as Record<string, string>)}` : '/api/proof', {
    method, signal, ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Proof request failed')
  return data.result
}
export const webProof: ProofService = {
  read: (cwd, signal) => request('GET', { cwd, action: 'read' }, signal),
  configure: (cwd, checks, version) => request('POST', { cwd, action: 'configure', checks, version }),
  start: (cwd, ids, version, origin) => request('POST', { cwd, action: 'start', ids, version, origin }),
  cancel: (cwd, id) => request('POST', { cwd, action: 'cancel', id }),
  output: (cwd, id, checkId, signal) => request('GET', { cwd, action: 'output', id, checkId }, signal),
}
