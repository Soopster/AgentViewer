export type ComposerSkillSource = 'project' | 'user' | 'command'

export interface ComposerSkill {
  /** Unique within a listing: the skill's folder key, or the command name. */
  key: string
  name: string
  description: string
  source: ComposerSkillSource
  /** Provider instance ids whose own skill roots hold it ("claude", "codex", …). */
  loadedBy: string[]
  /** The provider the listing was made for loads it natively. */
  nativeForProvider: boolean
  files: string[]
  /** Absolute SKILL.md path; absent for a live command with no file. */
  path?: string
  /** Skills Manager ids, for previewing a copy into another provider's root. */
  skillId?: string
  rootId?: string
}
