import type { MattSkillsState } from '../mattSkills/service'

/** Matt Pocock's bundled skills and whether the repository is set up for them. */
export type PluginMattSkillsService = {
  readonly read: (cwd: string, signal?: AbortSignal) => Promise<MattSkillsState>
}
