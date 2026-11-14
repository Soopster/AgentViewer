import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'goals', title: 'Session goals',
  description: 'Create and manage a goal from the composer; the server engine keeps working independently.',
  renderers: ['web', 'tui'], stateVersion: 1, surfaces: [],
  composer: [{ id: 'session-goal', title: 'Session goal', maxRows: 1, services: ['composer'] }],
  commands: [{ id: 'goal', label: 'Session goal — work until done', category: 'Session', handler: 'open',
    scope: 'session', requires: 'session', renderers: ['web', 'tui'], services: ['composer-accessories'],
    keywords: ['goal', 'objective', 'budget', 'continue', 'done'],
  }],
} as const satisfies PluginManifest
