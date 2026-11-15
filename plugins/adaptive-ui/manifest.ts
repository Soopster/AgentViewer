import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
// Cards for tool calls nothing draws specially, designed as data (lib/plugins/cardTemplates.ts),
// reviewed here as drafts and saved as files to be reused. This plugin ships no renderer code:
// the hosts draw the blocks a rule makes.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'adaptive-ui', title: 'Adaptive UI',
  description: 'Design, review and reuse transcript cards for tool calls that nothing draws specially.',
  renderers: ['web', 'tui'], stateVersion: 1,
  surfaces: [{ id: 'adaptive-ui', title: 'Adaptive UI', pin: null, single: true, keys: 'window', placements: ['overlay', 'window', 'panel'], panelOrder: 230, windowLabel: 'Adaptive UI in a window', services: ['adaptive-ui'], optionalServices: ['composer', 'notices'] }],
  commands: [{ id: 'adaptive-ui', label: 'Adaptive UI cards', category: 'View', opens: 'adaptive-ui', requires: null, scope: 'application', renderers: ['web', 'tui'], keywords: ['cards', 'render', 'recipes', 'adaptive', 'tool', 'transcript', 'design'] }],
  behavior: { hooks: ['toolCard', 'transcriptCard', 'runtimeEvent'], order: 90 },
} as const satisfies PluginManifest
