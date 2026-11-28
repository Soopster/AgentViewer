import type { PluginMattSkillsService } from '../../lib/plugins/mattSkills'

export const webMattSkills: PluginMattSkillsService = {
  async read(cwd, signal) {
    const response = await fetch(`/api/matt-skills?cwd=${encodeURIComponent(cwd)}`, { signal })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body?.error || `Matt Pocock skills answered ${response.status}`)
    return body
  },
}
