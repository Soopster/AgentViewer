import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// pstack (MIT, Lauren Tan), vendored under ./vendor. `/pstack <task>` is a prompt command: the
// beforeTurn hook points the agent at the skill files, so it works the same in all five providers.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'pstack',
  title: 'pstack',
  description: 'poteto\'s engineering playbooks, principles and review skills. Type /pstack <task>, and choose which model takes each role.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  behavior: { hooks: ['beforeTurn'], order: 40 },
  promptSlash: [{ name: 'pstack', description: 'Work in pstack style: /pstack <task>, or /pstack /<skill> <task>', argumentHint: '<task>' }],
  surfaces: [{
    id: 'pstack',
    title: '≡ pstack',
    pin: 'cwd',
    single: true,
    keys: 'capture',
    placements: ['overlay', 'window'],
    windowLabel: 'pstack in a window',
    services: ['repository', 'pstack', 'playbooks'],
    optionalServices: ['notices'],
  }],
  commands: [{
    id: 'pstack-open',
    label: 'pstack — model roles and playbooks',
    category: 'Coordination',
    opens: 'pstack',
    requires: 'repository',
    scope: 'repository',
    renderers: ['web', 'tui'],
    keywords: ['pstack', 'poteto', 'playbooks', 'principles', 'interrogate', 'arena', 'swarm', 'models', 'roles'],
  }],
  blocks: [
    { kind: 'context', pattern: '<pstack_context skill="([a-z0-9-]{1,80})">[\\s\\S]{0,12000}?</pstack_context>', title: 'pstack · {1}', tone: 'info' },
  ],
} as const satisfies PluginManifest
