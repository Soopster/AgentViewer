import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// mattpocock/skills (MIT, Matt Pocock), vendored under ./vendor. `/matt` is a prompt command: the
// beforeTurn hook points the agent at the skill files, so it works the same in all five providers.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'matt-skills',
  title: 'Matt Pocock skills',
  description: 'Grilling, spec and ticket flows, TDD, code review and domain modelling. Type /matt <what you are doing>, or /matt /<skill> <task>.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  behavior: { hooks: ['beforeTurn'], order: 41 },
  promptSlash: [{ name: 'matt', description: 'Matt Pocock skills: /matt <what you are doing>, or /matt /<skill> <task>', argumentHint: '<task>' }],
  surfaces: [{
    id: 'matt-skills',
    title: '✎ Matt Pocock skills',
    pin: 'cwd',
    single: true,
    keys: 'capture',
    placements: ['overlay', 'window'],
    windowLabel: 'Matt Pocock skills in a window',
    services: ['repository', 'matt-skills', 'playbooks'],
    optionalServices: ['composer', 'notices'],
  }],
  commands: [{
    id: 'matt-skills-open',
    label: 'Matt Pocock skills — flows and repository setup',
    category: 'Coordination',
    opens: 'matt-skills',
    requires: 'repository',
    scope: 'repository',
    renderers: ['web', 'tui'],
    keywords: ['matt', 'pocock', 'skills', 'grill', 'tdd', 'spec', 'tickets', 'triage', 'wayfinder', 'code review', 'glossary'],
  }],
  blocks: [
    { kind: 'context', pattern: '<matt_skills_context skill="([a-z0-9-]{1,80})">[\\s\\S]{0,6000}?</matt_skills_context>', title: 'Matt Pocock · {1}', tone: 'info' },
  ],
} as const satisfies PluginManifest
