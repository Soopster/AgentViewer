import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Pull requests: the repository's GitHub PRs, their diff with review notes,
// discussion and checks, reviewed and answered through `gh`. Repository reads
// and writes stay in lib/githubPr.ts and lib/review/, which both renderers share.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'pull-requests',
  title: 'Pull requests',
  description: "Review the repository's GitHub pull requests: diff, notes, discussion and checks, through gh.",
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    // `pull-request` is the side-panel kind both hosts and saved layouts already use.
    id: 'pull-request',
    title: '⑂ Pull request',
    pin: 'cwd',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window', 'panel'],
    windowLabel: 'Pull request in a window',
    services: ['repository'],
    // Questions and review notes go to the composer; the Web view also links a PR to the session.
    optionalServices: ['composer', 'session-pull-request'],
    fullScreen: true,
  }],
  commands: [{
    id: 'pull-requests',
    label: 'Review pull requests',
    category: 'Session',
    opens: 'pull-request',
    requires: null,
    renderers: ['web', 'tui'],
    tuiKey: { name: 'g', ctrl: true, shift: true },
    tuiKeyLabel: '⌃K g / ⌃⇧G',
    keywords: ['github', 'pull request', 'pr', 'review', 'comment', 'approve', 'gh'],
  }],
} as const satisfies PluginManifest
