import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'web-results',
  title: 'Web Results',
  description: 'Show sources and excerpts for OpenCode and Pi web tools.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [],
  commands: [],
  behavior: { hooks: ['toolCard'] },
} as const satisfies PluginManifest
