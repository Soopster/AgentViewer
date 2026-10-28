import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// File history: one file scrubbed through the turn checkpoints, a step per turn
// that changed it, with per-hunk undo and restore. It is opened on a file (from
// the editor, a checkpoint row), so it has no command of its own: the host's
// `file-history` service is how other views open it.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'file-history',
  title: 'File history',
  description: 'Scrub one file through the turn checkpoints, undo a hunk, or restore it to before a turn.',
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'file-history',
    title: '⌚ File history',
    pin: 'path',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'File history in a window',
    services: ['repository'],
    optionalServices: ['notices', 'composer'],
  }],
  commands: [],
} as const satisfies PluginManifest
