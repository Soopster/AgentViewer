import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Coordination: the views over Coordinator runs — the agent control center
// (every run's board) and a conversation's own team. The runs, the sweep, the
// teammates and their notifications are the host's (lib/agentCoordination.ts,
// the coordinator stores): turning these views off or closing them stops none
// of it.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'coordination',
  title: 'Coordination',
  description: 'The agent control center over every Coordinator run, and the teammates panel for a conversation.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  dashboards: [{ id: 'agents', title: 'Agent Operations', glyph: '◎', icon: 'users-round', launcherLabel: 'Open Agent Operations dashboard', command: 'coord-board', surface: 'coordination', order: -10 }],
  surfaces: [{
    // One coordination store, so one view of it.
    id: 'coordination',
    title: '◆ Control center',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Agent control center in a window',
    services: ['coordination', 'playbooks', 'run-launch'],
    optionalServices: ['composer', 'notices'],
    scrim: true,
  }, {
    // The interactive coordinator's store holds one conversation's team.
    id: 'teammates',
    title: '◆ Teammates',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Teammates in a window',
    services: ['coordination'],
    optionalServices: ['notices', 'playbooks'],
  }, {
    id: 'playbooks', title: '▦ Playbooks', pin: 'cwd', single: true, keys: 'capture',
    placements: ['overlay', 'window'], windowLabel: 'Playbook manager in a window',
    services: ['playbooks', 'repository'], optionalServices: ['notices'],
  }, {
    id: 'new-workflow', title: '◆ New workflow', pin: 'cwd', single: true, keys: 'capture',
    placements: ['overlay', 'window'], windowLabel: 'New workflow in a window',
    services: ['repository', 'playbooks', 'run-launch'], optionalServices: ['session', 'composer', 'notices', 'coordination'],
  }],
  commands: [{
    id: 'coord-start', label: 'Start coordinated run', category: 'Coordination',
    opens: 'new-workflow', requires: 'repository', scope: 'repository', renderers: ['web', 'tui'],
    tuiChord: { key: 'n', short: 'run', label: 'New coordinated run' },
    tuiKey: { name: 'n', ctrl: true, shift: true }, tuiKeyLabel: '⌃K n / ⌃⇧N',
    keywords: ['workflow', 'coordinated', 'run', 'new', 'playbook', 'team'],
  }, {
    id: 'playbooks', label: 'Manage playbooks', category: 'Coordination',
    opens: 'playbooks', requires: 'repository', scope: 'repository', renderers: ['web', 'tui'],
    keywords: ['playbook', 'workflow', 'template', 'manage'],
  }, {
    id: 'coord-board',
    label: 'Open Agent Operations',
    category: 'Coordination',
    opens: 'coordination',
    requires: null,
    scope: 'application',
    renderers: ['web', 'tui'],
    tuiChord: { key: 'a', short: 'ops', label: 'Agent Operations' },
    // On the Web the control center is a dashboard tab.
    webDashboard: 'agents',
    // ⌃K a is the portable path where Ctrl+Shift cannot be told from Ctrl.
    tuiKey: { name: 'a', ctrl: true, shift: true },
    tuiKeyLabel: '⌃K a / ⌃⇧A',
    keywords: ['agent', 'team', 'coordinator', 'coordination', 'teammate', 'task board', 'worktree', 'multiagent', 'multi-agent'],
  }, {
    id: 'coord-teammates',
    label: 'Teammates for this conversation',
    category: 'Coordination',
    opens: 'teammates',
    requires: 'session',
    // On the web the panel is the conversation's Teammates tab.
    renderers: ['tui'],
    tuiChord: { key: 't', short: 'team', label: 'Teammates for this conversation' },
    tuiKeyLabel: '⌃K t',
    keywords: ['team', 'teammates', 'lead', 'delegate', 'coordinator'],
  }],
} as const satisfies PluginManifest
