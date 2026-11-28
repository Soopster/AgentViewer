import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Focus Mode: a timed block during which nothing that can wait interrupts you.
// Permission asks, questions, sessions waiting on you, warnings and errors are
// delivered as always; finished turns, teammate results and informational
// notices are held, and one digest lists them when the block ends.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'focus-mode',
  title: 'Focus Mode',
  description: 'Hold non-urgent notifications for a timed block, then read them as one digest. Approvals and questions still come through.',
  renderers: ['web', 'tui'],
  application: { events: ['sessionActivity'], services: ['notifications', 'focus'] },
  stateVersion: 1,
  surfaces: [{
    id: 'focus-mode',
    title: '◐ Focus',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Focus in a window',
    services: ['focus-mode'],
    optionalServices: ['notices', 'session-navigation'],
  }],
  commands: [{
    id: 'focus-mode',
    label: 'Focus Mode — hold interruptions for a while',
    category: 'Session',
    opens: 'focus-mode',
    scope: 'application',
    requires: null,
    renderers: ['web', 'tui'],
    // The pending-⌃K hint is at its width budget: listed in ⌃K ? and the unknown-key notice instead.
    tuiChord: { key: 'z', short: 'focus', label: 'Focus Mode', hint: false },
    keywords: ['focus', 'do not disturb', 'dnd', 'quiet', 'pomodoro', 'deep work', 'notifications', 'digest'],
  }, {
    id: 'focus-slash',
    label: 'Focus Mode (slash)',
    category: 'Session',
    handler: 'slash',
    // Composer slash commands are session-scoped; the block itself is machine-wide.
    scope: 'session',
    requires: 'session',
    renderers: ['web', 'tui'],
    services: ['notices', 'commands'],
    composerSlash: { name: 'focus', description: 'Hold non-urgent notifications for a while (45m by default); /focus off ends it', argumentHint: '[45m | 1h | off]' },
    keywords: ['focus'],
  }],
  widgets: [{ id: 'status', slot: 'corner' }],
} as const satisfies PluginManifest
