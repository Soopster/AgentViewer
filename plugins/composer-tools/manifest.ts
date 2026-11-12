import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'composer-tools', title: 'Composer tools',
  description: 'Reuse the last user prompt from the target session without opening a view.',
  renderers: ['web', 'tui'], stateVersion: 1, surfaces: [],
  commands: [{
    id: 'reuse', label: 'Reuse last prompt', category: 'Session', handler: 'reuse',
    scope: 'session', requires: 'session', renderers: ['web', 'tui'],
    services: ['transcript', 'composer'],
    tuiKey: { name: 'r', shift: true }, tuiKeyLabel: '⇧R', tuiKeyContext: 'navigation',
    keywords: ['reuse', 'last prompt', 'repeat', 'composer'],
  }],
} as const satisfies PluginManifest
