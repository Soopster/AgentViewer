import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'instructions-manager', title: 'Instructions Manager', description: 'Inspect instruction scopes, edit known files and preview independent copies across providers.', renderers: ['web', 'tui'], stateVersion: 1,
  surfaces: [{ id: 'instructions-manager', title: 'Instructions Manager', pin: 'cwd', single: false, keys: 'window', placements: ['overlay', 'window', 'panel'], panelOrder: 215, windowLabel: 'Instructions Manager in a window', services: ['repository', 'instructions-manager'] }],
  commands: [{ id: 'instructions-manager', label: 'Instructions Manager', category: 'Session', opens: 'instructions-manager', requires: 'repository', scope: 'repository', renderers: ['web', 'tui'], keywords: ['instructions', 'rules', 'AGENTS.md', 'CLAUDE.md', 'copilot', 'copy', 'config'] }],
} as const satisfies PluginManifest
