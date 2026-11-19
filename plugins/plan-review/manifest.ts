import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'plan-review', title: 'Plan Review',
  description: 'Annotate plans, request revisions, and approve before choosing to implement.',
  renderers: ['web', 'tui'], stateVersion: 1,
  surfaces: [{ id: 'plan-review', title: 'Plan Review', pin: 'session', single: false, keys: 'window', placements: ['overlay', 'window', 'panel'], windowLabel: 'Plan Review in a window', panelOrder: 200, services: ['repository', 'plan-review'], optionalServices: ['session', 'clipboard'] }],
  commands: [{ id: 'plan-review', label: 'Plan Review', category: 'Session', opens: 'plan-review', requires: 'session', renderers: ['web', 'tui'], webToolbarLabel: 'Review plan', keywords: ['plan', 'annotate', 'approve', 'feedback', 'revision'] }],
  widgets: [{ id: 'pending', slot: 'corner' }],
  behavior: { hooks: ['afterTurn'], order: 100 },
} as const satisfies PluginManifest
