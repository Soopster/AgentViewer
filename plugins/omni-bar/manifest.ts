import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'omni-bar',
  title: 'Omni bar',
  description: 'Workspace and session context, attention, and shortcuts to files, terminal, search and new sessions.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  widgets: [{ id: 'overview', slot: 'top-bar' }],
  surfaces: [{
    id: 'omni-bar-actions', title: 'Omni bar actions', pin: null, single: true,
    windowLabel: 'Omni bar actions',
    keys: 'capture', placements: ['overlay'], services: ['shell-overview'],
  }, {
    id: 'omni-bar-settings', title: 'Customize omni bar', pin: null, single: true,
    windowLabel: 'Omni bar settings',
    keys: 'capture', placements: ['overlay'], services: [],
  }],
  commands: [{
    id: 'omni-bar-actions', label: 'Omni bar actions', category: 'View',
    scope: 'application', requires: null, opens: 'omni-bar-actions',
    renderers: ['web', 'tui'], keywords: ['omni', 'workspace', 'attention', 'activity', 'files', 'terminal', 'search', 'new'],
  }, {
    id: 'omni-bar-settings', label: 'Customize omni bar', category: 'View',
    scope: 'application', requires: null, opens: 'omni-bar-settings',
    renderers: ['web', 'tui'], keywords: ['omni', 'bar', 'customize', 'order', 'enable', 'disable', 'shortcuts', 'settings'],
  }],
} as const satisfies PluginManifest
