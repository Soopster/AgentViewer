import type { ProjectMemoryService } from '../../../lib/plugins/projectMemory'
import { nativeProjectMemory } from '../../../lib/project-memory/service'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'
export const tuiProjectMemory: ProjectMemoryService = {
  read: async (cwd, signal) => isRemoteAttached() ? (await remoteJson<{ result: Awaited<ReturnType<ProjectMemoryService['read']>> }>(`/api/project-memory?${new URLSearchParams({ cwd })}`, { signal })).result : nativeProjectMemory.read(cwd, signal),
  mutate: async (cwd, requestId, operation, signal) => isRemoteAttached() ? (await remoteJson<{ result: Awaited<ReturnType<ProjectMemoryService['read']>> }>('/api/project-memory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd, requestId, operation }), signal })).result : nativeProjectMemory.mutate(cwd, requestId, operation, signal),
}
