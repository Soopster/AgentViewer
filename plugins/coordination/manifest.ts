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
  surfaces: [{
    // One coordination store, so one view of it.
    id: 'coordination',
    title: '◆ Control center',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Agent control center in a window',
    services: ['coordination'],
    optionalServices: ['composer', 'notices'],
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
    optionalServices: ['notices'],
  }],
  commands: [{
    id: 'coord-board',
    label: 'Open Agent Operations',
    category: 'Coordination',
    opens: 'coordination',
    requires: null,
    renderers: ['web', 'tui'],
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
    tuiKeyLabel: '⌃K t',
    keywords: ['team', 'teammates', 'lead', 'delegate', 'coordinator'],
  }],
} as const satisfies PluginManifest
