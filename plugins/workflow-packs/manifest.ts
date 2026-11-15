import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
export const manifest = { apiVersion: PLUGIN_API_VERSION, id: 'workflow-packs', title: 'Workflow Packs', description: 'Preview and install reusable engineering workflows into repository playbooks.', renderers: ['web', 'tui'], stateVersion: 1,
  surfaces: [{ id: 'workflow-packs', title: 'Workflow Packs', pin: 'cwd', single: false, keys: 'window', placements: ['overlay', 'window', 'panel'], panelOrder: 230, windowLabel: 'Workflow Packs in a window', services: ['repository', 'playbooks'] }],
  commands: [{ id: 'workflow-packs', label: 'Workflow Packs', category: 'Coordination', opens: 'workflow-packs', scope: 'repository', requires: 'repository', renderers: ['web', 'tui'], keywords: ['workflows', 'packs', 'templates', 'debugging', 'tdd', 'review', 'playbooks'] }],
} as const satisfies PluginManifest
