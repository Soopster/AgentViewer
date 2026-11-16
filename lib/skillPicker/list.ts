import type { SkillsSnapshot } from '../plugins/skillsManager'
import type { SlashCommandSuggestion } from '../slashCommands'
import type { ComposerSkill } from './types'

/** "Claude (claude)" → "claude". A consumer that names no instance ("Shared", the library) → null. */
function instanceOf(consumer: string): string | null {
  return /\(([a-z0-9:_-]+)\)$/i.exec(consumer)?.[1] ?? null
}

const loads = (instanceId: string, provider: string) =>
  instanceId === provider || instanceId.startsWith(`${provider}:`) || instanceId.startsWith(`${provider}-`)

// Inventory paths belong to the server's filesystem, even in a remote browser.
// Preserve their separator without importing Node APIs into the Web picker.
function skillFilePath(root: string, key: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return [root.replace(/[\\/]+$/, ''), ...key.split('/'), 'SKILL.md'].join(separator)
}

/**
 * The skills a composer can offer for `provider`: every installed skill the Skills
 * Manager found, merged by folder across roots, plus live non-builtin slash commands
 * (skills and plugin commands a provider reports that have no folder we can see).
 */
export function composerSkillsFromSnapshot(
  snapshot: SkillsSnapshot,
  liveCommands: readonly SlashCommandSuggestion[],
  provider: string,
): ComposerSkill[] {
  const rootsById = new Map(snapshot.roots.map(root => [root.id, root]))
  const byKey = new Map<string, ComposerSkill>()
  for (const skill of snapshot.skills) {
    const root = rootsById.get(skill.rootId)
    if (!root) continue
    const loadedBy = root.consumers.map(instanceOf).filter((id): id is string => id !== null)
    const existing = byKey.get(skill.key)
    if (existing) {
      for (const id of loadedBy) if (!existing.loadedBy.includes(id)) existing.loadedBy.push(id)
      // A project copy is the one that applies here, so it wins over a user one.
      if (root.scope === 'project' && existing.source === 'user') {
        existing.source = 'project'
        existing.path = skillFilePath(root.path, skill.key)
        existing.skillId = skill.id
        existing.rootId = root.id
        existing.description = skill.description || existing.description
      }
      continue
    }
    byKey.set(skill.key, {
      key: skill.key,
      name: skill.name || skill.key,
      description: skill.description,
      source: root.scope,
      loadedBy: [...new Set(loadedBy)],
      nativeForProvider: false,
      files: skill.files.map(file => file.path),
      path: skillFilePath(root.path, skill.key),
      skillId: skill.id,
      rootId: root.id,
    })
  }
  const live = new Map(liveCommands.filter(command => !command.builtin).map(command => [command.command.replace(/^\//, '').toLowerCase(), command]))
  for (const skill of byKey.values()) {
    const reported = live.get(skill.name.toLowerCase()) ?? live.get(skill.key.toLowerCase())
    // The provider listing it is the surest sign it loads it; the root's consumers are the fallback.
    skill.nativeForProvider = Boolean(reported) || skill.loadedBy.some(id => loads(id, provider))
    if (reported) live.delete(skill.name.toLowerCase()), live.delete(skill.key.toLowerCase())
  }
  const skills = [...byKey.values()]
  for (const [name, command] of live) {
    skills.push({
      key: `command:${name}`,
      name,
      description: command.description,
      source: 'command',
      loadedBy: [provider],
      nativeForProvider: true,
      files: [],
    })
  }
  return skills
}
