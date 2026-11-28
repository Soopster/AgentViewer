/** Browser-safe Skills Manager contract; discovery and copies are host services. */
export type SkillRoot = { id: string; path: string; label: string; scope: 'user' | 'project'; consumers: string[]; exists: boolean; writable: boolean; note?: string }
export type SkillFile = { path: string; bytes: number; hash: string; mode: number }
export type InstalledSkill = { id: string; rootId: string; key: string; name: string; description: string; hash: string; files: SkillFile[]; linked: boolean; syncable: boolean; issues: string[] }
export type SkillsSnapshot = { roots: SkillRoot[]; skills: InstalledSkill[]; diagnostics: string[]; receipts: SkillCopyReceipt[] }
export type SkillCopyTarget = { rootId: string; path: string; status: 'add' | 'same' | 'replace' | 'blocked'; hash: string | null; files: { path: string; status: 'add' | 'same' | 'replace' | 'remove' }[]; reason?: string }
export type SkillCopyPreview = { id: string; sourceId: string; sourceHash: string; sourceName: string; targets: SkillCopyTarget[] }
export type SkillCopyRequest = { sourceId: string; targetIds: string[] }
export type SkillCopyApply = SkillCopyRequest & { previewId: string; replaceIds: string[]; requestId: string }
export type SkillCopyReceipt = { id: string; status: 'applying' | 'applied' | 'partial' | 'failed'; sourceName: string; results: { rootId: string; path: string; status: 'copied' | 'unchanged' | 'failed'; backup?: string; error?: string }[]; createdAt: number; error?: string }
export type SkillsManagerService = {
  scan(cwd: string, signal?: AbortSignal): Promise<SkillsSnapshot>
  file(cwd: string, skillId: string, file: string, signal?: AbortSignal): Promise<{ text: string; binary: boolean; truncated: boolean }>
  preview(cwd: string, request: SkillCopyRequest, signal?: AbortSignal): Promise<SkillCopyPreview>
  apply(cwd: string, request: SkillCopyApply, signal?: AbortSignal): Promise<SkillCopyReceipt>
}
export function skillCopyStatus(snapshot: SkillsSnapshot, source: InstalledSkill, targetId: string): 'same' | 'different' | 'missing' {
  const target = snapshot.skills.find(skill => skill.rootId === targetId && skill.key === source.key)
  return !target ? 'missing' : target.hash === source.hash ? 'same' : 'different'
}
