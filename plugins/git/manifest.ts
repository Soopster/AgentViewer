import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Git: the working tree, a diff review with notes, and the commit/branch
// workspace, for one repository. Repository reads and writes stay in
// lib/git*.ts and lib/review/, which both renderers' views share.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'git',
  title: 'Git',
  description: 'The working tree, diff review with notes, and the commit and branch workspace for a repository.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    // `diff` is the side-panel kind both hosts and saved layouts already use.
    id: 'diff',
    title: '± Git',
    pin: 'cwd',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window', 'panel'],
    panelOrder: 20,
    windowLabel: 'Git in a window',
    services: ['repository'],
    // Review notes and "ask an agent" go to the composer; the Web view has neither yet.
    optionalServices: ['composer', 'clipboard'],
    fullScreen: true,
  }],
  commands: [{
    id: 'git',
    label: 'Git status',
    category: 'Session',
    opens: 'diff',
    requires: null,
    renderers: ['web', 'tui'],
    tuiKey: { name: 'g', ctrl: true },
    tuiKeyLabel: '⌃G',
    keywords: ['diff', 'review', 'commit', 'branch', 'status', 'changes'],
  }],
} as const satisfies PluginManifest
