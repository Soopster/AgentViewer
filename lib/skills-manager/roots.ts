import { homedir } from 'node:os'
import path from 'node:path'
import { lstat, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { listProviderInstances, type ProviderInstance } from '../providerInstances'
import { isPluginEnabled } from '../plugins/enablement'
import { pstackSkillsDir } from '../pstack/library'
import { mattLibrary } from '../mattSkills/service'
import type { SkillRoot } from '../plugins/skillsManager'
export const skillDigest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export type SkillsContext = { home: string; environment: Record<string, string | undefined>; instances: Pick<ProviderInstance, 'id' | 'provider' | 'displayName' | 'environment'>[]; dataDir: string; bundled?: readonly { path: string; label: string }[] }
export async function skillsContext(): Promise<SkillsContext> {
  const bundled = [
    ...isPluginEnabled('pstack') ? [{ path: pstackSkillsDir(), label: 'pstack (bundled)' }] : [],
    ...isPluginEnabled('matt-skills') ? [{ path: mattLibrary.skillsDir(), label: 'Matt Pocock skills (bundled)' }] : [],
  ]
  return { bundled, home: homedir(), environment: process.env, instances: await listProviderInstances(), dataDir: process.env.AGENT_VIEWER_SKILLS_DATA_DIR || path.join(homedir(), '.agent-viewer', 'skills-manager') }
}
/** Canonicalize existing ancestors too, so aliases to a missing folder share one identity. */
export async function canonicalSkillPath(input: string): Promise<string> {
  try { return await realpath(input) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(input)
    if (parent === input) return input
    return path.join(await canonicalSkillPath(parent), path.basename(input))
  }
}
const expand = (value: string, home: string, cwd: string) => path.resolve(cwd, value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value)
export async function discoverSkillRoots(cwd: string, context: SkillsContext): Promise<SkillRoot[]> {
  const project = await realpath(cwd)
  const candidates: { path: string; scope: 'user' | 'project'; label: string; consumer: string }[] = []
  const add = (root: string, scope: 'user' | 'project', label: string, consumer: string) => candidates.push({ path: path.resolve(root), scope, label, consumer })
  add(path.join(context.environment.XDG_CONFIG_HOME || path.join(context.home, '.config'), 'agent-viewer', 'skills'), 'user', 'Agent Viewer library', 'Library (copy source; not loaded by providers)')
  // Shared skills remain visible even if no particular provider is enabled.
  add(path.join(context.home, '.agents', 'skills'), 'user', 'Shared agent skills', 'Shared')
  add(path.join(project, '.agents', 'skills'), 'project', 'Shared project skills', 'Shared')
  for (const bundle of context.bundled ?? []) add(bundle.path, 'user', bundle.label, 'Library (copy source; not loaded by providers)')
  for (const instance of context.instances) {
    const env = { ...context.environment, ...instance.environment }, home = env.HOME || env.USERPROFILE || context.home
    const label = `${instance.displayName} (${instance.id})`
    const user = (root: string) => add(root, 'user', `${instance.displayName} user skills`, label)
    const local = (folder: string) => add(path.join(project, folder, 'skills'), 'project', `${instance.displayName} project skills`, label)
    if (instance.provider === 'claude') { user(path.join(expand(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), home, project), 'skills')); local('.claude') }
    if (instance.provider === 'codex') { user(path.join(expand(env.CODEX_HOME || path.join(home, '.codex'), home, project), 'skills')); local('.codex') }
    if (instance.provider === 'pi') { user(path.join(expand(env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent'), home, project), 'skills')); local('.pi') }
    if (instance.provider === 'opencode') { user(path.join(expand(env.OPENCODE_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode'), home, project), 'skills')); local('.opencode') }
    if (instance.provider === 'copilot') { user(path.join(home, '.copilot', 'skills')); local('.github') }
    if (['codex', 'opencode', 'copilot'].includes(instance.provider)) {
      add(path.join(home, '.agents', 'skills'), 'user', 'Shared agent skills', label)
      add(path.join(project, '.agents', 'skills'), 'project', 'Shared project skills', label)
    }
  }
  const roots = new Map<string, SkillRoot>()
  for (const candidate of candidates) {
    let canonical: string, exists = false, writable = true, note: string | undefined
    try {
      canonical = await canonicalSkillPath(candidate.path)
      try { const stat = await lstat(candidate.path); exists = true; if (!stat.isDirectory() && !stat.isSymbolicLink()) { writable = false; note = 'Location is not a directory' } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (canonical !== candidate.path) { writable = false; note = 'Linked location; copies must target a direct skill folder' }
    } catch (error) { canonical = candidate.path; writable = false; note = error instanceof Error ? error.message : String(error) }
    if (context.bundled?.some(bundle => path.resolve(bundle.path) === candidate.path)) { writable = false; note = 'Shipped with Agent Viewer; copy from here' }
    const existing = roots.get(canonical)
    if (existing) {
      if (!existing.consumers.includes(candidate.consumer)) existing.consumers.push(candidate.consumer)
      if (writable) { existing.writable = true; delete existing.note }
      continue
    }
    roots.set(canonical, { id: skillDigest(canonical), path: canonical, label: candidate.label, scope: candidate.scope, consumers: [candidate.consumer], exists, writable, ...(note ? { note } : {}) })
  }
  return [...roots.values()]
}
