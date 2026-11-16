import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'tips', title: 'Tips',
  description: 'Occasional hints about Agent Viewer features while an agent works.',
  renderers: ['web', 'tui'], stateVersion: 1, surfaces: [], commands: [],
  composer: [{ id: 'feature-tip', title: 'Feature tip', placement: 'footer', maxRows: 1, services: [] }],
} as const satisfies PluginManifest
