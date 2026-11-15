import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'project-memory', title: 'Shared Project Memory', description: 'Review project decisions, conventions and lessons, and opt into recall across providers.', renderers: ['web', 'tui'], stateVersion: 1,
  surfaces: [{ id: 'project-memory', title: 'Shared Project Memory', pin: 'cwd', single: false, keys: 'window', placements: ['overlay', 'window', 'panel'], panelOrder: 220, windowLabel: 'Project Memory in a window', services: ['repository', 'project-memory'], optionalServices: ['session', 'session-transcript', 'session-navigation'] }],
  commands: [{ id: 'project-memory', label: 'Shared Project Memory', category: 'Session', opens: 'project-memory', requires: 'repository', scope: 'repository', renderers: ['web', 'tui'], keywords: ['memory', 'knowledge', 'decisions', 'lessons', 'conventions', 'recall'] }],
  behavior: { hooks: ['beforeTurn'], order: 50 },
} as const satisfies PluginManifest
