import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Recurring prompts. The engine (lib/schedules) fires them; this plugin is the list:
// when each runs next, what happened last, and run-now / pause / delete.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'schedules',
  title: 'Schedules',
  description: 'Run a prompt on a timer: every hour, or on a cron schedule, in a chosen session or a fresh one.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'schedules',
    title: '⏱ Schedules',
    pin: null,
    single: true,
    keys: 'window',
    placements: ['overlay', 'window', 'panel'],
    windowLabel: 'Schedules in a window',
    services: ['schedules'],
    optionalServices: ['notices'],
  }],
  widgets: [{ id: 'next-run', slot: 'corner' }],
  commands: [{
    id: 'schedules-open',
    label: 'Schedules',
    category: 'Coordination',
    opens: 'schedules',
    requires: null,
    scope: 'application',
    renderers: ['web', 'tui'],
    keywords: ['schedule', 'cron', 'recurring', 'timer', 'every'],
  }, {
    id: 'schedule-create',
    label: 'Schedule a prompt in this session',
    category: 'Session',
    handler: 'create',
    scope: 'session',
    requires: 'session',
    renderers: ['web', 'tui'],
    services: ['schedules', 'notices'],
    composerSlash: { name: 'schedule', description: 'Run a prompt on a timer in this session', argumentHint: 'every 1h <prompt> | "0 9 * * 1-5" <prompt>' },
    keywords: ['schedule', 'recurring', 'cron', 'every'],
  }],
} as const satisfies PluginManifest
