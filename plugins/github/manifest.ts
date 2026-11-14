import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// GitHub: the day-to-day half of GitHub that is not reviewing a diff — what
// needs me (review requests, my PRs, assigned issues, notifications), issues,
// CI runs with the failing step's log, and pull-request lifecycle (create,
// merge, ready, checkout, reviewers). All of it runs through `gh` in
// lib/github/, shared by both renderers; reviewing a PR's diff and discussion
// stays in the pull-requests plugin, which this one links to.
//
// No chord yet: ⌃⇧H arrives as ⌃H (backspace) on terminals that cannot report
// Shift, so it is palette-first until a free key is picked.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'github',
  title: 'GitHub',
  description: 'Repository overview, inbox, pull requests, issues, CI runs, releases and security alerts, with actions, through gh.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'github',
    title: '◈ GitHub',
    pin: 'cwd',
    single: false,
    // The TUI view takes text (comments, titles) itself, so it holds every key; only ⌃B escapes.
    keys: 'capture',
    placements: ['overlay', 'window'],
    windowLabel: 'GitHub in a window',
    services: ['repository'],
    // A prompt built from an issue or a failing run goes to the composer.
    optionalServices: ['composer', 'notices'],
    fullScreen: true,
  }],
  commands: [{
    id: 'github',
    label: 'GitHub: overview, inbox, PRs, issues, CI, releases, security',
    category: 'Session',
    opens: 'github',
    requires: 'repository',
    renderers: ['web', 'tui'],
    keywords: ['github', 'gh', 'issues', 'actions', 'ci', 'workflow', 'run', 'merge', 'inbox', 'review requested', 'notifications', 'release', 'security', 'dependabot', 'branches', 'commits'],
  }],
} as const satisfies PluginManifest
