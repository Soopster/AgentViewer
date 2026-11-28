import type { PluginMattSkillsService } from '../../../lib/plugins/mattSkills'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'

export const tuiMattSkills: PluginMattSkillsService = {
  async read(cwd, signal) {
    signal?.throwIfAborted()
    if (isRemoteAttached()) return remoteJson(`/api/matt-skills?cwd=${encodeURIComponent(cwd)}`)
    return (await import('../../../lib/mattSkills/service')).readMattSkills(cwd)
  },
}
