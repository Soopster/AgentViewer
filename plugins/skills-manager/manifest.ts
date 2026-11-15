import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'skills-manager', title: 'Skills Manager',
  description: 'Browse installed skills, compare locations, and preview copies between providers and projects.',
  renderers: ['web', 'tui'], stateVersion: 1,
  surfaces: [{ id: 'skills-manager', title: 'Skills Manager', pin: 'cwd', single: false, keys: 'window', placements: ['overlay', 'window', 'panel'], panelOrder: 210, windowLabel: 'Skills Manager in a window', services: ['repository', 'skills-manager'] }],
  commands: [{ id: 'skills-manager', label: 'Skills Manager', category: 'Session', opens: 'skills-manager', requires: 'repository', scope: 'repository', renderers: ['web', 'tui'], keywords: ['skills', 'installed', 'sync', 'copy', 'capabilities', 'accounts'] }],
} as const satisfies PluginManifest
