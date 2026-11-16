import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginCommandModule } from '../../lib/plugins/commands'
import { seedSkillQuery } from './seed'

export const commands: PluginCommandModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'skill-picker',
  // `/skill` opens the picker the palette and the chord open; `/skill review` starts it searching for "review".
  handlers: { open: ({ services, input }) => { seedSkillQuery(input?.slash.arguments ?? ''); services.commands!.run('skill-picker') } },
}
