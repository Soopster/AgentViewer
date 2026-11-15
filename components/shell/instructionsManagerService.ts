import type { InstructionsManagerService } from '../../lib/plugins/instructionsManager'
async function request<T>(cwd: string, operation?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(operation ? '/api/instructions-manager' : `/api/instructions-manager?${new URLSearchParams({ cwd })}`, operation ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, ...operation }), signal } : { signal, cache: 'no-store' })
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Instructions Manager request failed'); return value.result
}
export const webInstructionsManager: InstructionsManagerService = {
  scan: (cwd, signal) => request(cwd, undefined, signal),
  read: async (cwd, path, signal) => { const response = await fetch(`/api/instructions-manager?${new URLSearchParams({ cwd, path })}`, { signal, cache: 'no-store' }); const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Instruction read failed'); return value.result },
  preview: (cwd, change, signal) => request(cwd, { action: 'preview', change }, signal),
  apply: (cwd, requestId, previewHash, change, replace, signal) => request(cwd, { action: 'apply', requestId, previewHash, change, replace }, signal),
}
