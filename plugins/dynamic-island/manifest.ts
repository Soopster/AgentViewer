import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'dynamic-island', title: 'Dynamic island',
  description: 'A compact activity island for running agents, attention, background work and app notices.',
  renderers: ['web', 'tui'], stateVersion: 1,
  application: { events: ['sessionActivity'], services: ['activity'] },
  widgets: [{ id: 'island', slot: 'top-center' }],
  surfaces: [{ id: 'activity-island', title: 'Activity island', windowLabel: 'Activity island', pin: null, single: true, keys: 'capture', placements: ['overlay'], optionalServices: ['session-navigation'], services: [] }],
  commands: [{ id: 'activity-island', toggle: true, label: 'Toggle activity island', category: 'View', scope: 'application', requires: null, opens: 'activity-island', renderers: ['web', 'tui'], keywords: ['activity', 'island', 'notifications', 'progress'] }],
} as const satisfies PluginManifest
