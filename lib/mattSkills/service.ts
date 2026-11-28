// Node side: the vendored library, and whether this repository has been set up for it.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { skillPackLibrary } from '../skillPacks/library'

export const mattLibrary = skillPackLibrary('matt-skills', 'AGENT_VIEWER_MATT_SKILLS_DIR')

export interface MattSkill { name: string; description: string; userInvoked: boolean }
export interface MattSkillsState {
  version: string
  skills: MattSkill[]
  setup: { root: string; configured: boolean; files: { path: string; exists: boolean }[] }
}

const SETUP_FILES = ['docs/agents/issue-tracker.md', 'docs/agents/domain.md', 'docs/agents/triage-labels.md', 'GLOSSARY.md']

/** The checkout `cwd` is in, so a subdirectory reads the same setup as the root. */
function checkoutRoot(cwd: string): string {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) return dir
    if (path.dirname(dir) === dir) return path.resolve(cwd)
  }
}

export function mattSetup(cwd: string): MattSkillsState['setup'] {
  const root = checkoutRoot(cwd)
  const files = SETUP_FILES.map(file => ({ path: file, exists: existsSync(path.join(root, file)) }))
  return { root, configured: files[0]!.exists, files }
}

export function parseMattSkill(name: string, source: string): MattSkill {
  const front = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const raw = front.match(/^description:[ \t]*(.*)$/m)?.[1]?.trim() ?? ''
  const description = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\"/g, '"') : raw
  return { name, description, userInvoked: /^disable-model-invocation:[ \t]*true\b/m.test(front) }
}

export async function readMattSkills(cwd: string): Promise<MattSkillsState> {
  let version = 'missing'
  try { version = String((JSON.parse(await readFile(path.join(mattLibrary.libraryDir(), 'VENDOR.json'), 'utf8')) as { version?: string }).version ?? 'unknown') } catch {}
  const skills = await Promise.all(mattLibrary.list().map(async name => parseMattSkill(name, await readFile(mattLibrary.skillFile(name), 'utf8'))))
  return { version, skills, setup: mattSetup(cwd) }
}
