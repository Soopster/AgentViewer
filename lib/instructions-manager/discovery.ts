import path from 'node:path'
import { homedir } from 'node:os'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { listProviderInstances, type ProviderInstance } from '../providerInstances'
import type { InstructionFile, InstructionsSnapshot } from '../plugins/instructionsManager'
export type InstructionsContext = { home: string; environment: Record<string, string | undefined>; instances: Pick<ProviderInstance, 'id' | 'provider' | 'displayName' | 'environment'>[]; dataDir: string }
export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export const instructionsContext = async (): Promise<InstructionsContext> => ({ home: homedir(), environment: process.env, instances: await listProviderInstances(), dataDir: process.env.AGENT_VIEWER_INSTRUCTIONS_DATA_DIR || path.join(homedir(), '.agent-viewer', 'instructions-manager') })
const expand = (value: string, home: string, cwd: string) => path.resolve(cwd, value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value)
export async function canonicalPath(file: string): Promise<string> {
  try { return await realpath(file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent = path.dirname(file); return parent === file ? file : path.join(await canonicalPath(parent), path.basename(file)) }
}
export const within = (root: string, file: string) => { const relative = path.relative(root, file); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) }
const BASENAMES = ['AGENTS.md', 'AGENTS.override.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD', 'CLAUDE.local.md', 'GEMINI.md']
const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'vendor', 'coverage', 'target'])
export async function discoverInstructions(cwd: string, context: InstructionsContext): Promise<InstructionsSnapshot & { ruleRoots: { path: string; scope: 'user' | 'project' | 'nested'; consumers: string[]; kind: 'claude' | 'copilot' }[] }> {
  cwd = await realpath(cwd)
  let project = cwd
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    try { await lstat(path.join(dir, '.git')); project = dir; break } catch {}
    if (path.dirname(dir) === dir) break
  }
  const files = new Map<string, InstructionFile>(), diagnostics: string[] = []
  const ruleRoots: { path: string; scope: 'user' | 'project' | 'nested'; consumers: string[]; kind: 'claude' | 'copilot' }[] = []
  const add = async (file: string, scope: InstructionFile['scope'], consumers: string[], applies: string, missing = false) => {
    file = path.resolve(file)
    // Do not invent uppercase fallback entries on case-insensitive filesystems.
    if (file.endsWith('.MD')) { try { if (!(await readdir(path.dirname(file))).includes(path.basename(file))) return } catch { return } }
    let exists = false, linked = false, writable = scope !== 'ancestor', note: string | undefined
    try {
      const info = await lstat(file); exists = true
      if (!info.isFile() && !info.isSymbolicLink()) { writable = false; note = 'Not a regular file' }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { writable = false; note = String(error) } }
    if (!exists && !missing) return
    try { linked = await canonicalPath(file) !== file; if (linked) { writable = false; note = 'Linked path: inspect only; edit the direct instruction file instead' } } catch (error) { writable = false; note = String(error) }
    const previous = files.get(file)
    if (previous) { previous.consumers = [...new Set([...previous.consumers, ...consumers])]; return }
    if (files.size >= 350) { if (!diagnostics.includes('Inventory limited to 350 files.')) diagnostics.push('Inventory limited to 350 files.'); return }
    files.set(file, { id: digest(file), path: file, label: path.relative(scope === 'user' ? context.home : project, file) || path.basename(file), scope, consumers: [...new Set(consumers)], applies, exists, writable, linked, ...(note ? { note } : {}) })
  }
  const shared = ['Codex', 'OpenCode', 'Pi', 'Copilot', 'Claude (version/settings dependent)']
  const consumerFor = (name: string) => name === 'AGENTS.MD' || name === 'CLAUDE.MD' ? ['Pi fallback'] : name === 'CLAUDE.local.md' ? ['Claude'] : name === 'AGENTS.override.md' ? ['Codex override', 'Pi override'] : name.startsWith('CLAUDE') ? ['Claude', 'Copilot (CLAUDE.md)'] : name === 'GEMINI.md' ? ['Copilot compatibility'] : shared
  const addDirectory = async (dir: string, scope: 'project' | 'nested' | 'ancestor', missing = false) => {
    for (const name of BASENAMES) await add(path.join(dir, name), scope, consumerFor(name), `Directory guidance: ${dir}; descendants and precedence depend on provider.`, missing && ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'CLAUDE.local.md'].includes(name))
    await add(path.join(dir, '.claude', 'CLAUDE.md'), scope, ['Claude', 'Copilot'], 'Claude project instructions; Copilot compatibility.', missing)
    await add(path.join(dir, '.github', 'copilot-instructions.md'), scope, ['Copilot'], 'Repository-wide Copilot instructions.', missing)
    if (scope !== 'ancestor') {
      ruleRoots.push({ path: path.join(dir, '.claude', 'rules'), scope, consumers: ['Claude'], kind: 'claude' })
      ruleRoots.push({ path: path.join(dir, '.github', 'instructions'), scope, consumers: ['Copilot'], kind: 'copilot' })
    }
  }
  // Always show creation targets in the opening directory and repository root.
  await addDirectory(cwd, 'project', true)
  if (project !== cwd) await addDirectory(project, 'project', true)
  for (let dir = path.dirname(cwd); ; dir = path.dirname(dir)) {
    if (dir !== cwd && dir !== project) await addDirectory(dir, within(project, dir) ? 'project' : 'ancestor')
    if (path.dirname(dir) === dir) break
  }
  for (const instance of context.instances) {
    const env = { ...context.environment, ...instance.environment }, home = env.HOME || env.USERPROFILE || context.home, label = `${instance.displayName} (${instance.id})`
    const root = (value: string) => expand(value, home, cwd)
    if (instance.provider === 'claude') {
      const base = root(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'))
      await add(path.join(base, 'CLAUDE.md'), 'user', [label], 'User instructions across projects.', true)
      ruleRoots.push({ path: path.join(base, 'rules'), scope: 'user', consumers: [label], kind: 'claude' })
    }
    if (instance.provider === 'codex') {
      const base = root(env.CODEX_HOME || path.join(home, '.codex'))
      for (const name of ['AGENTS.md', 'AGENTS.override.md']) await add(path.join(base, name), 'user', [label], 'Global Codex instructions; override takes priority when applicable.', true)
    }
    if (instance.provider === 'opencode') await add(path.join(root(env.OPENCODE_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode')), 'AGENTS.md'), 'user', [label], 'Global OpenCode guidance; custom config instructions are not expanded.', true)
    if (instance.provider === 'pi') {
      const base = root(env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent'))
      for (const name of ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']) await add(path.join(base, name), 'user', [label], 'Pi global context candidate; first supported file wins. SYSTEM.md replacement is outside this manager.', name === 'AGENTS.md')
    }
    if (instance.provider === 'copilot') {
      await add(path.join(home, '.copilot', 'copilot-instructions.md'), 'user', [label], 'User Copilot instructions across repositories.', true)
      ruleRoots.push({ path: path.join(home, '.copilot', 'instructions'), scope: 'user', consumers: [label], kind: 'copilot' })
    }
  }
  let directories = 0
  const walk = async (dir: string, depth: number) => {
    if (++directories > 2500 || files.size >= 350) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && diagnostics.length < 25) diagnostics.push(`Cannot scan ${dir}: ${String(error)}`); return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue
      const child = path.join(dir, entry.name)
      await addDirectory(child, 'nested')
      if (depth < 8) await walk(child, depth + 1)
      else if (diagnostics.length < 25) diagnostics.push(`Nested discovery stops at depth 8: ${child}`)
    }
  }
  await walk(project, 0)
  const seenRules = new Set<string>()
  for (const rule of ruleRoots) {
    const scanRules = async (dir: string, depth: number) => {
      if (depth > 8 || ++directories > 2500 || files.size >= 350) return
      let entries
      try { if (await canonicalPath(dir) !== dir) return; entries = await readdir(dir, { withFileTypes: true }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && diagnostics.length < 25) diagnostics.push(`Cannot scan rules ${dir}: ${String(error)}`); return }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory() && !entry.name.startsWith('.')) await scanRules(file, depth + 1)
        else if (entry.name.endsWith(rule.kind === 'copilot' ? '.instructions.md' : '.md')) await add(file, rule.scope, rule.consumers, `${rule.kind === 'claude' ? 'paths' : 'applyTo'} frontmatter may restrict matching files. Provider settings determine loading.`)
      }
    }
    // Physical files are deduplicated by add; repeated accounts still get their labels.
    const identity = `${rule.path}:${rule.consumers.join(',')}`
    if (!seenRules.has(identity)) { seenRules.add(identity); await scanRules(rule.path, 0) }
  }
  if (directories > 2500) diagnostics.push('Discovery limited to 2500 directories.')
  diagnostics.push('Known files only: custom instruction config entries, imports, managed policies and runtime activation are not resolved.')
  return { cwd, project, files: [...files.values()], diagnostics, receipts: [], ruleRoots }
}
export function allowedNewRule(file: string, inventory: Awaited<ReturnType<typeof discoverInstructions>>): InstructionFile | null {
  for (const root of inventory.ruleRoots) {
    const relative = path.relative(root.path, file)
    if (!relative || !within(root.path, file) || relative.split(path.sep).some(part => part.startsWith('.') || !/^[\w .-]+$/.test(part))) continue
    if (!file.endsWith(root.kind === 'copilot' ? '.instructions.md' : '.md')) continue
    return { id: digest(file), path: file, label: path.relative(inventory.project, file), scope: root.scope, consumers: root.consumers, applies: `${root.kind === 'claude' ? 'paths' : 'applyTo'} frontmatter can scope this rule.`, exists: false, writable: true, linked: false }
  }
  return null
}
