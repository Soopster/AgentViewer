import type { SendAttachment } from '../types'
import type { ComposerSkill } from './types'

export type SkillInsertPlan =
  /** The provider loads it: put its own invocation in the draft. */
  | { kind: 'native'; text: string }
  /** The provider does not load it; offer to attach SKILL.md, or to install it for that provider. */
  | { kind: 'unavailable'; attach: SendAttachment | null; canInstall: boolean }

/**
 * How each provider is told to use a skill it has loaded. Claude, Copilot and Pi take a
 * slash command; Codex a `$name` mention; OpenCode loads skills through a tool the model
 * calls, so the draft names the skill rather than invoking syntax that does not exist.
 */
export function nativeSkillText(provider: string, name: string): string {
  switch (provider) {
    case 'codex': return `$${name} `
    case 'pi': return `/skill:${name} `
    case 'opencode': return `Use the "${name}" skill. `
    default: return `/${name} `
  }
}

export function planSkillInsert(skill: ComposerSkill, provider: string): SkillInsertPlan {
  if (skill.nativeForProvider) return { kind: 'native', text: nativeSkillText(provider, skill.name) }
  return {
    kind: 'unavailable',
    // An ordinary file attachment: every provider can read a path, and the model gets the skill's own text.
    attach: skill.path ? { type: 'file', path: skill.path, displayName: `skill: ${skill.name}` } : null,
    canInstall: Boolean(skill.skillId),
  }
}
