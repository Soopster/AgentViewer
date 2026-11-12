import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'prompt-library',
  title: 'Prompt library',
  description: 'Create, edit and insert saved prompt templates with fill-in fields across providers.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'prompt-library', title: '❝ Prompts', pin: null, single: true,
    keys: 'capture', placements: ['overlay', 'window'],
    windowLabel: 'Prompt library in a window',
    services: ['composer'], optionalServices: ['session', 'notices'],
  }],
  commands: [{
    id: 'prompt-library', label: 'Prompt library', category: 'Session',
    opens: 'prompt-library', requires: 'session', renderers: ['tui'],
    tuiKey: { name: 'p', shift: true }, tuiKeyLabel: '⇧P',
    keywords: ['prompt', 'prompts', 'library', 'template', 'snippet', 'saved', 'reuse', 'composer'],
  }, {
    id: 'open-prompt-library', label: 'Open prompt library', category: 'Session',
    opens: 'prompt-library', requires: 'session', renderers: ['web'],
    webComposerLabel: 'Prompt library', webComposerGlyph: '❝',
    keywords: ['prompt', 'template', 'snippet', 'saved'],
  }],
} as const satisfies PluginManifest
