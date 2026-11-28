import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'toasts', title: 'Toast notifications',
  description: 'Floating notifications in the terminal and the Web. Works independently or alongside the dynamic island.',
  renderers: ['web', 'tui'], stateVersion: 1, surfaces: [], commands: [],
  widgets: [{ id: 'toasts', slot: 'viewport' }],
} as const satisfies PluginManifest
