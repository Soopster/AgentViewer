import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Checkpoints & review: the snapshot every agent turn took of the working tree,
// what changed since any of them, restoring files, and the working diff as
// rejectable hunks with commit and PR. Snapshots stay in lib/checkpoints.ts.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'checkpoints',
  title: 'Checkpoints & review',
  description: "Every agent turn's working-tree snapshot, restore, and the working diff as rejectable hunks.",
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'checkpoints',
    title: '⟲ Checkpoints',
    // Checkpoints are the repository's, not a session's: one view of them.
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Checkpoints & review in a window',
    services: ['repository'],
    optionalServices: ['notices', 'file-history'],
  }],
  commands: [{
    id: 'checkpoints',
    label: 'Checkpoints & review',
    category: 'Session',
    opens: 'checkpoints',
    requires: 'repository',
    renderers: ['tui'],
    tuiKey: { name: 'u', shift: true },
    tuiKeyLabel: '⇧U',
    keywords: ['checkpoint', 'snapshot', 'restore', 'undo', 'turn', 'review', 'hunk', 'commit'],
  }],
} as const satisfies PluginManifest
