import type { PluginCommandLoaders } from '../../lib/plugins/commandHost'

export const webPluginCommands: PluginCommandLoaders = {
  bridges: async () => (await import('../../plugins/bridges/commands')).commands,
  better: async () => (await import('../../plugins/better/commands')).commands,
  schedules: async () => (await import('../../plugins/schedules/commands')).commands,
  'chief-of-staff': async () => (await import('../../plugins/chief-of-staff/commands')).commands,
  'skill-picker': async () => (await import('../../plugins/skill-picker/commands')).commands,
  goals: async () => (await import('../../plugins/goals/commands')).commands,
  'mod-views': async () => (await import('../../plugins/mod-views/commands')).commands,
  'composer-tools': async () => (await import('../../plugins/composer-tools/commands')).commands,
}
