import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// The prompts of worktree tasks in the terminal: naming a new task, and confirming a
// merge or a discard. Creating, merging and discarding are the host's (they touch git
// and the session list); this plugin is the dialog that asks.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'worktree-tasks',
  title: 'Worktree task prompts',
  description: 'The dialogs for starting a worktree task and for confirming its merge or discard.',
  group: 'Code & repository',
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'worktree-new', title: '⎇ New worktree task', pin: null, single: true, windowLabel: 'New worktree task',
    keys: 'capture', placements: ['overlay'], services: ['worktree-tasks'],
  }, {
    id: 'worktree-confirm', title: '⎇ Worktree task', pin: null, single: true, windowLabel: 'Confirm worktree task',
    keys: 'capture', placements: ['overlay'], services: ['worktree-tasks'],
  }],
  commands: [],
} as const satisfies PluginManifest
