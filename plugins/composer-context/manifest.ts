import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'composer-context',
  title: 'Composer context',
  description: 'Expand attached file, image, terminal, diff and browser references before sending a turn.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [],
  commands: [],
  behavior: { hooks: ['beforeTurn'], order: 100 },
} as const satisfies PluginManifest
