import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
import { COS_DIGEST_PROMPTS } from '../../lib/chiefOfStaff/digestPrompts'

// A standing lead for a repository: it splits requests into workstreams and delegates them to
// teammates by rule, and never edits files itself. Its schedules are declared and stay off.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'chief-of-staff',
  title: 'Chief of Staff',
  description: 'One standing chat per repository that triages requests and delegates to the right provider and model. It never edits files.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'chief-of-staff',
    title: '☗ Chief of Staff',
    pin: 'cwd',
    single: true,
    keys: 'capture',
    placements: ['overlay', 'window'],
    windowLabel: 'Chief of Staff in a window',
    services: ['repository', 'chief-of-staff'],
    optionalServices: ['session', 'session-navigation', 'notices'],
  }],
  behavior: { hooks: ['beforeTurn', 'afterTurn', 'permission'], order: 50, permissionMode: 'policy' },
  schedules: [
    { id: 'morning-digest', name: 'Chief of Staff: morning digest', trigger: { kind: 'cron', expression: '0 9 * * 1-5' }, action: { kind: 'plugin-command', command: 'chief-of-staff:morning' }, prompt: COS_DIGEST_PROMPTS.morning },
    { id: 'stale-check', name: 'Chief of Staff: blocked and stale check', trigger: { kind: 'every', amount: 1, unit: 'h' }, action: { kind: 'plugin-command', command: 'chief-of-staff:stale' }, prompt: COS_DIGEST_PROMPTS.stale },
    { id: 'end-of-day', name: 'Chief of Staff: end-of-day report', trigger: { kind: 'cron', expression: '0 17 * * 1-5' }, action: { kind: 'plugin-command', command: 'chief-of-staff:eod' }, prompt: COS_DIGEST_PROMPTS.eod },
  ],
  commands: [{
    id: 'chief-of-staff-open',
    label: 'Chief of Staff',
    category: 'Coordination',
    opens: 'chief-of-staff',
    requires: 'repository',
    scope: 'repository',
    renderers: ['web', 'tui'],
    keywords: ['chief of staff', 'cos', 'delegate', 'triage', 'lead'],
  }, {
    id: 'chief-of-staff-slash',
    label: 'Chief of Staff (slash)',
    category: 'Coordination',
    handler: 'open',
    scope: 'session',
    requires: 'session',
    renderers: ['web', 'tui'],
    services: ['commands'],
    composerSlash: { name: 'cos', description: 'Hand a request to this repository\'s Chief of Staff', argumentHint: '<request>' },
    keywords: ['cos'],
  }],
} as const satisfies PluginManifest
