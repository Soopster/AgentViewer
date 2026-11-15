import type { SkillsManagerService } from '../../../lib/plugins/skillsManager'
import { nativeSkillsManager } from '../../../lib/skills-manager/service'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'
async function request<T>(action: string, cwd: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (action === 'scan' || action === 'file') {
    const params = new URLSearchParams({ action, cwd, ...(action === 'file' ? { skillId: String(body.skillId), file: String(body.file) } : {}) })
    return (await remoteJson<{ result: T }>(`/api/skills-manager?${params}`, { signal })).result
  }
  return (await remoteJson<{ result: T }>('/api/skills-manager', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, cwd, ...body }), signal })).result
}
export const tuiSkillsManager: SkillsManagerService = {
  scan: (cwd, signal) => isRemoteAttached() ? request('scan', cwd, {}, signal) : nativeSkillsManager.scan(cwd, signal),
  file: (cwd, skillId, file, signal) => isRemoteAttached() ? request('file', cwd, { skillId, file }, signal) : nativeSkillsManager.file(cwd, skillId, file, signal),
  preview: (cwd, input, signal) => isRemoteAttached() ? request('preview', cwd, { input }, signal) : nativeSkillsManager.preview(cwd, input, signal),
  apply: (cwd, input, signal) => isRemoteAttached() ? request('apply', cwd, { input }, signal) : nativeSkillsManager.apply(cwd, input, signal),
}
