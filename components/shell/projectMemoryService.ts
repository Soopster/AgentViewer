import type { ProjectMemoryService } from '../../lib/plugins/projectMemory'
async function request<T>(cwd: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(body ? '/api/project-memory' : `/api/project-memory?${new URLSearchParams({ cwd })}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, ...body }), signal } : { signal, cache: 'no-store' })
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Project Memory request failed'); return value.result
}
export const webProjectMemory: ProjectMemoryService = { read: (cwd, signal) => request(cwd, undefined, signal), mutate: (cwd, requestId, operation, signal) => request(cwd, { requestId, operation }, signal) }
