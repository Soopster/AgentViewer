import type { PluginCommandLoaders } from '../../lib/plugins/commandHost'

export const webPluginCommands: PluginCommandLoaders = {
  bridges: async () => (await import('../../plugins/bridges/commands')).commands,
  goals: async () => (await import('../../plugins/goals/commands')).commands,
  'composer-tools': async () => (await import('../../plugins/composer-tools/commands')).commands,
}
