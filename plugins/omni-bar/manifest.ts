import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'omni-bar',
  title: 'Omni bar',
  description: 'Workspace context, current activity and attention across the top of the terminal.',
  renderers: ['tui'],
  stateVersion: 1,
  widgets: [{ id: 'overview', slot: 'top-bar' }],
  surfaces: [{
    id: 'omni-bar-actions', title: 'Omni bar actions', pin: null, single: true,
    windowLabel: 'Omni bar actions',
    keys: 'capture', placements: ['overlay'], services: ['shell-overview'],
  }],
  commands: [{
    id: 'omni-bar-actions', label: 'Omni bar actions', category: 'View',
    scope: 'application', requires: null, opens: 'omni-bar-actions',
    renderers: ['tui'], keywords: ['omni', 'workspace', 'attention', 'activity'],
  }],
} as const satisfies PluginManifest
