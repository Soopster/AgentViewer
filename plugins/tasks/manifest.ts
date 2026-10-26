import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// The task list: a session's todos and background tasks, grouped by state,
// built from its transcript plus the turn that is still streaming. The task
// side panel (⇧T) is layout, not this view, and stays with the host.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'tasks',
  title: 'Task list',
  description: "A session's todos and background tasks, grouped by state, with stop and jump.",
  renderers: ['tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'tasks',
    title: '☑ Tasks',
    pin: 'session',
    single: false,
    keys: 'window',
    placements: ['overlay', 'window'],
    windowLabel: 'Task list in a window',
    services: ['session-transcript'],
    optionalServices: ['live-transcript', 'task-control'],
  }],
  commands: [{
    // `tasks` is the host's side-panel command; this id is the palette's old one.
    id: 'tasks-full',
    label: 'Task lineage popover',
    category: 'Transcript',
    opens: 'tasks',
    requires: null,
    renderers: ['tui'],
    tuiKey: { name: 'l', shift: true },
    tuiKeyLabel: '⇧L',
    keywords: ['tasks', 'todos', 'background', 'bashes', 'lineage'],
  }],
} as const satisfies PluginManifest
