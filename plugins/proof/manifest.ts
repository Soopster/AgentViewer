import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'proof', title: 'Proof',
  description: 'Run verification checks and keep receipts tied to the code they checked.',
  renderers: ['web', 'tui'], stateVersion: 1,
  surfaces: [{ id: 'proof', title: '✓ Proof', pin: 'cwd', single: false, keys: 'window',
    placements: ['overlay', 'window', 'panel'], windowLabel: 'Proof in a window',
    services: ['repository', 'proof'], optionalServices: ['composer', 'session'] }],
  commands: [{ id: 'proof', label: 'Proof — verify changes', category: 'Session', opens: 'proof',
    requires: 'repository', scope: 'repository', renderers: ['web', 'tui'], keywords: ['checks', 'tests', 'verification', 'evidence', 'receipts'] }],
  widgets: [{ id: 'status', slot: 'corner' }],
} as const satisfies PluginManifest
