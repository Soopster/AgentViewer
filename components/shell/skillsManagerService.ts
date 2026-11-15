import type { SkillsManagerService } from '../../lib/plugins/skillsManager'
async function request<T>(action: string, cwd: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const reading = action === 'scan' || action === 'file'
  const params = new URLSearchParams({ action, cwd, ...(action === 'file' ? { skillId: String(body.skillId), file: String(body.file) } : {}) })
  const response = await fetch(reading ? `/api/skills-manager?${params}` : '/api/skills-manager', reading ? { signal, cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, cwd, ...body }), signal })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'Skills Manager request failed')
  return value.result
}
export const webSkillsManager: SkillsManagerService = {
  scan: (cwd, signal) => request('scan', cwd, {}, signal),
  file: (cwd, skillId, file, signal) => request('file', cwd, { skillId, file }, signal),
  preview: (cwd, input, signal) => request('preview', cwd, { input }, signal),
  apply: (cwd, input, signal) => request('apply', cwd, { input }, signal),
}
