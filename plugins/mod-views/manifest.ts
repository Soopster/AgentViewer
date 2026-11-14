import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Interactive views from the user's mods (lib/plugins/modViews.ts): a mod
// returns a view as data from its server module, and this plugin draws it in
// both renderers — selectable rows and buttons run the mod's actions, which
// answer with a notice and a re-render. No build step: the mod's code runs
// where turns run.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'mod-views',
  title: 'Mod views',
  description: "Interactive views your mods provide, as panels in the Web and the terminal.",
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'mod-views',
    title: '◇ Mod views',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Mod views in a window',
    services: [],
    optionalServices: ['notices'],
  }],
  commands: [{
    id: 'mod-views',
    label: 'Mod views',
    category: 'View',
    opens: 'mod-views',
    requires: null,
    scope: 'application',
    renderers: ['web', 'tui'],
    tuiChord: { key: 'x', short: 'mods', label: 'Views from your mods' },
    keywords: ['mod', 'mods', 'extension', 'local plugin', 'view', 'panel'],
  }],
} as const satisfies PluginManifest
