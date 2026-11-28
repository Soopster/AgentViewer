import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Second Opinion: another model reads one agent turn's diff and says what it
// would question before the change is committed. A Claude turn goes to Codex
// and anything else to Claude unless the repository says otherwise. Reviews are
// asked for, or run on every settled turn when the repository turns that on —
// either way they spend model usage, so nothing runs by default.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'second-opinion',
  title: 'Second Opinion',
  description: "Another model reviews an agent turn's diff, Codex for Claude and Claude for the rest. Sends the diff to a model.",
  renderers: ['web', 'tui'],
  stateVersion: 1,
  behavior: { hooks: ['afterTurn'] },
  surfaces: [{
    id: 'second-opinion',
    title: '◎ Second opinion',
    pin: 'cwd',
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Second opinion in a window',
    services: ['repository', 'checkpoints', 'second-opinion'],
    optionalServices: ['session', 'composer', 'notices', 'open-file'],
  }],
  commands: [{
    id: 'second-opinion',
    label: 'Second opinion — review a turn with another model',
    category: 'Session',
    opens: 'second-opinion',
    requires: 'repository',
    scope: 'repository',
    renderers: ['web', 'tui'],
    sessionMenu: true,
    // The pending-⌃K hint is at its width budget: listed in ⌃K ? and the unknown-key notice instead.
    tuiChord: { key: 'i', short: '2nd', label: 'Second opinion on a turn', hint: false },
    keywords: ['review', 'second opinion', 'codex', 'claude', 'cross-model', 'turn', 'diff', 'bug'],
  }],
} as const satisfies PluginManifest
