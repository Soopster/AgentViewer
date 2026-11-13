import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// The run dashboard: every session in scope as a run — status, project,
// branch, last tool and what it waits on. The Web shell's home dashboard
// (`sessions`). Session listing and selection are the shell's, offered as
// `session-fleet`; the TUI's equivalents are the sidebar and the desk.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'run-dashboard',
  title: 'Run dashboard',
  description: 'Every session in scope as a run: status, project, branch, the last tool and what it waits on.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  dashboards: [{ id: 'sessions', title: 'Runs', glyph: '▦', icon: 'layout-dashboard', launcherLabel: 'Open run dashboard', command: 'open-run-dashboard', surface: 'run-dashboard', order: -20 }],
  surfaces: [{
    id: 'run-dashboard',
    title: '▦ Run dashboard',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Run dashboard',
    services: ['session-fleet'],
  }],
  commands: [{
    id: 'open-run-dashboard',
    label: 'Open run dashboard',
    category: 'View',
    opens: 'run-dashboard',
    requires: null,
    scope: 'application',
    renderers: ['web'],
    webDashboard: 'sessions',
    keywords: ['dashboard', 'runs', 'sessions', 'overview', 'status'],
  }, {
    // The TUI has no dashboard tabs: the same surface opens over the layout, or as a window.
    id: 'run-dashboard',
    label: 'Run dashboard',
    category: 'View',
    opens: 'run-dashboard',
    requires: null,
    renderers: ['tui'],
    tuiChord: { key: 'r', short: 'runs', label: 'Run dashboard: every session as a run', hint: false },
    keywords: ['dashboard', 'runs', 'sessions', 'overview', 'status', 'fleet'],
  }],
} as const satisfies PluginManifest
