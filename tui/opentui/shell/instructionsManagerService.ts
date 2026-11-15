import type { InstructionsManagerService } from '../../../lib/plugins/instructionsManager'
import { nativeInstructionsManager } from '../../../lib/instructions-manager/service'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'
async function remote<T>(cwd: string, operation?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await remoteJson<{ result: T }>(operation ? '/api/instructions-manager' : `/api/instructions-manager?${new URLSearchParams({ cwd })}`, operation ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, ...operation }), signal } : { signal })
  return response.result
}
export const tuiInstructionsManager: InstructionsManagerService = {
  scan: (cwd, signal) => isRemoteAttached() ? remote(cwd, undefined, signal) : nativeInstructionsManager.scan(cwd, signal),
  read: (cwd, path, signal) => isRemoteAttached() ? remoteJson<{ result: Awaited<ReturnType<InstructionsManagerService['read']>> }>(`/api/instructions-manager?${new URLSearchParams({ cwd, path })}`, { signal }).then(value => value.result) : nativeInstructionsManager.read(cwd, path, signal),
  preview: (cwd, change, signal) => isRemoteAttached() ? remote(cwd, { action: 'preview', change }, signal) : nativeInstructionsManager.preview(cwd, change, signal),
  apply: (cwd, requestId, previewHash, change, replace, signal) => isRemoteAttached() ? remote(cwd, { action: 'apply', requestId, previewHash, change, replace }, signal) : nativeInstructionsManager.apply(cwd, requestId, previewHash, change, replace, signal),
}
