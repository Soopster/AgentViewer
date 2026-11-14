import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION, id: 'better', title: 'Better prompts',
  description: 'Deepen a draft using repository research, concrete methods and independent checks, then review it in the composer.',
  renderers: ['web', 'tui'], stateVersion: 1, surfaces: [],
  composer: [{ id: 'better-prompt', title: 'Better prompt', maxRows: 2, services: ['composer'] }],
  commands: [{
    id: 'better', label: 'Better prompt', category: 'Session', handler: 'open',
    scope: 'session', requires: 'session', renderers: ['web', 'tui'], services: ['composer-accessories'],
    tuiChord: { key: 'e', short: 'better', label: 'Better prompt', hint: false },
    composerSlash: { name: 'better', description: 'Research and deepen a prompt, then review it in the composer', argumentHint: '[prompt]' },
    webComposerLabel: 'Better prompt', webComposerGlyph: '✦',
    keywords: ['better', 'deepen', 'rewrite', 'improve', 'prompt', 'composer'],
  }],
} as const satisfies PluginManifest
