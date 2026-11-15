import { lstat, readdir, readFile, realpath, open } from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'
import { parseDocument } from 'yaml'
import type { InstalledSkill, SkillFile, SkillRoot } from '../plugins/skillsManager'
import { skillDigest } from './roots'
export const MAX_SKILL_BYTES = 16 * 1024 * 1024
export const MAX_SKILL_FILES = 1000
export type SkillBundle = { hash: string; files: (SkillFile & { content: Buffer })[] }
export const safeSkillKey = (key: string) => key.length <= 1024 && key.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..' && !part.startsWith('.agent-viewer-'))
export function withinSkillRoot(root: string, file: string) { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) }
/** Never follow resource symlinks or execute package scripts. The top-level skill may be a read-only link. */
export async function readSkillBundle(directory: string, signal?: AbortSignal, rejectExcluded = false): Promise<SkillBundle> {
  const files: SkillBundle['files'] = []; let total = 0
  const walk = async (folder: string, prefix: string, depth: number) => {
    signal?.throwIfAborted()
    if (depth > 12) throw new Error('Skill exceeds 12 directory levels')
    const entries = (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') { if (rejectExcluded) throw new Error(`Destination contains ${entry.name}; choose a new destination to preserve its local files`); continue }
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name, file = path.join(folder, entry.name)
      const info = await lstat(file)
      if (info.isSymbolicLink()) throw new Error(`Linked resource cannot be copied: ${relative}`)
      if (info.isDirectory()) { await walk(file, relative, depth + 1); continue }
      if (!info.isFile()) throw new Error(`Unsupported resource: ${relative}`)
      if (files.length >= MAX_SKILL_FILES || total + info.size > MAX_SKILL_BYTES) throw new Error('Skill exceeds 1,000 files or 16 MiB')
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      let content: Buffer
      try { if (!(await handle.stat()).isFile()) throw new Error(`Not a regular resource: ${relative}`); content = await handle.readFile() } finally { await handle.close() }
      total += content.length
      if (total > MAX_SKILL_BYTES) throw new Error('Skill exceeds 16 MiB')
      files.push({ path: relative, bytes: content.length, hash: skillDigest(content), mode: info.mode & 0o777, content })
    }
  }
  await walk(directory, '', 0)
  const hash = skillDigest(JSON.stringify(files.map(({ path: file, hash, mode }) => [file, hash, mode])))
  return { hash, files }
}
export function skillMetadata(content: string): { name: string; description: string; issues: string[] } {
  const issues: string[] = [], match = content.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { name: '', description: '', issues: ['SKILL.md needs YAML frontmatter with name and description'] }
  try {
    const document = parseDocument(match[1], { uniqueKeys: true })
    if (document.errors.length) throw new Error(document.errors[0].message)
    const value = document.toJS({ maxAliasCount: 25 }) as { name?: unknown; description?: unknown } | null
    const name = typeof value?.name === 'string' ? value.name.trim() : '', description = typeof value?.description === 'string' ? value.description.trim() : ''
    if (!name) issues.push('Missing skill name')
    if (!description) issues.push('Missing skill description')
    return { name, description, issues }
  } catch (error) { return { name: '', description: '', issues: [`Invalid skill frontmatter: ${String(error)}`] } }
}
export async function inventorySkills(roots: SkillRoot[], signal?: AbortSignal): Promise<{ skills: InstalledSkill[]; diagnostics: string[] }> {
  const skills: InstalledSkill[] = [], diagnostics: string[] = []
  for (const root of roots) {
    if (!root.exists) continue
    let count = 0
    const seen = new Set<string>()
    const walk = async (directory: string, key: string, linked: boolean, depth: number) => {
      signal?.throwIfAborted()
      if (depth > 6 || count >= 2000) { diagnostics.push(`${root.label}: discovery limit reached`); return }
      const canonical = await realpath(directory)
      if (seen.has(canonical)) return
      seen.add(canonical)
      try {
      let skillText: string | null = null
      try {
        const file = path.join(canonical, 'SKILL.md'), info = await lstat(file)
        if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) throw new Error('SKILL.md must be a regular file under 256 KiB')
        skillText = await readFile(file, 'utf8')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (skillText !== null && key) {
        count++
        const metadata = skillMetadata(skillText), issues = [...metadata.issues]
        let hash = '', files: SkillFile[] = []
        try { const bundle = await readSkillBundle(canonical, signal); hash = bundle.hash; files = bundle.files.map(({ content: _content, ...file }) => file) } catch (error) { issues.push(error instanceof Error ? error.message : String(error)) }
        const reserved = key.split('/').some(part => part === '.system')
        if (reserved) issues.push('Provider-managed system skill; browse only')
        skills.push({ id: skillDigest(`${root.id}\n${key}`), rootId: root.id, key, name: metadata.name || path.basename(key), description: metadata.description, hash, files, linked, syncable: !!hash && !issues.length && safeSkillKey(key), issues })
        return
      }
      for (const entry of await readdir(canonical, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.agent-viewer-')) continue
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const childKey = key ? `${key}/${entry.name}` : entry.name
        if (!safeSkillKey(childKey)) continue
        try { await walk(path.join(canonical, entry.name), childKey, linked || entry.isSymbolicLink(), depth + 1) }
        catch (error) { diagnostics.push(`${root.label}/${childKey}: ${error instanceof Error ? error.message : String(error)}`) }
      }
      } finally { seen.delete(canonical) }
    }
    try { await walk(root.path, '', false, 0) } catch (error) { diagnostics.push(`${root.label}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return { skills, diagnostics }
}
