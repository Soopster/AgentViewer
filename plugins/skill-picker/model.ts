import type { SkillRoot, SkillsSnapshot } from '../../lib/plugins/skillsManager'
import { rankSkills, suggestSkills } from '../../lib/skillPicker/rank'
import type { ComposerSkill } from '../../lib/skillPicker/types'

export type PickerRow = { kind: 'header'; label: string } | { kind: 'skill'; skill: ComposerSkill; suggested?: boolean }

/**
 * Typing searches one ranked list. With nothing typed the list is grouped: Suggested (from
 * the draft), then Project, User and Commands, each ordered by use then name.
 */
export function pickerRows(skills: readonly ComposerSkill[], query: string, draft: string, frecency: (skill: ComposerSkill) => number): PickerRow[] {
  if (query.trim()) return rankSkills(skills, query, frecency).map(skill => ({ kind: 'skill', skill }))
  const rows: PickerRow[] = []
  const suggested = suggestSkills(skills, draft)
  if (suggested.length) {
    rows.push({ kind: 'header', label: 'SUGGESTED' }, ...suggested.map(skill => ({ kind: 'skill' as const, skill, suggested: true })))
  }
  const ordered = rankSkills(skills, '', frecency)
  for (const [source, label] of [['project', 'PROJECT'], ['user', 'USER'], ['command', 'COMMANDS']] as const) {
    const group = ordered.filter(skill => skill.source === source)
    if (group.length) rows.push({ kind: 'header', label }, ...group.map(skill => ({ kind: 'skill' as const, skill })))
  }
  return rows
}

/** Where "install for this provider" would put a skill: the provider's own project root, else its user root. */
export function installTarget(snapshot: SkillsSnapshot, provider: string): SkillRoot | null {
  const mine = snapshot.roots.filter(root => root.writable && root.consumers.some(consumer => {
    const id = /\(([a-z0-9:_-]+)\)$/i.exec(consumer)?.[1]
    return id !== undefined && (id === provider || id.startsWith(`${provider}:`) || id.startsWith(`${provider}-`))
  }))
  return mine.find(root => root.scope === 'project') ?? mine[0] ?? null
}

/** SKILL.md without its front matter, as lines for a preview pane. */
export function skillPreviewLines(text: string): string[] {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  return body.split(/\r?\n/)
}

/** The selected file's cached preview, or its loading/command-only placeholder. */
export function selectedSkillPreview(skill: ComposerSkill | undefined, previews: Record<string, string[]>): string[] {
  if (!skill) return []
  return previews[skill.key] ?? (skill.skillId ? ['loading…'] : [skill.description])
}

export const SKILL_USAGE_KEY = 'agentViewer:skillUsage'

/** Frecency: how often, discounted by age in days (the file pickers' rule). */
export function usageScore(entry: { n: number; last: number } | undefined, now = Date.now()): number {
  if (!entry) return 0
  return entry.n / (1 + Math.max(0, now - entry.last) / 86_400_000)
}
