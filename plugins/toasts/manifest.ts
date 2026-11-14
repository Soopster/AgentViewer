import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'toasts', title: 'Toast notifications',
  description: 'Floating terminal notifications. Works independently or alongside the dynamic island.',
  renderers: ['tui'], stateVersion: 1, surfaces: [], commands: [],
  widgets: [{ id: 'toasts', slot: 'viewport' }],
} as const satisfies PluginManifest
