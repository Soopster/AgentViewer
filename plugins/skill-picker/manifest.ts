import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

// Find a skill and put it in the prompt: the provider's own invocation when it loads the
// skill, otherwise attach SKILL.md or install it for that provider through Skills Manager.
export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'skill-picker',
  title: 'Skill picker',
  description: 'Search every installed skill, see what it does, and add it to a prompt in the way your provider understands.',
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [{
    id: 'skill-picker',
    title: '✦ Skills',
    pin: 'cwd',
    single: true,
    keys: 'capture',
    placements: ['overlay', 'window'],
    windowLabel: 'Skill picker in a window',
    services: ['repository', 'skills-manager', 'composer', 'session'],
    optionalServices: ['notices'],
  }],
  composer: [{ id: 'skill-chips', title: 'Skills in this prompt', maxRows: 1, services: ['composer'] }],
  commands: [{
    id: 'skill-picker',
    label: 'Pick a skill for this prompt',
    category: 'Session',
    opens: 'skill-picker',
    requires: 'repository',
    scope: 'repository',
    renderers: ['web', 'tui'],
    tuiChord: { key: 'k', short: 'skills', label: 'Skill picker', hint: false },
    webComposerLabel: 'Skills',
    webComposerGlyph: '✦',
    keywords: ['skill', 'skills', 'agent skill', 'slash', 'capability'],
  }, {
    id: 'skill-picker-slash',
    label: 'Skills (slash)',
    category: 'Session',
    handler: 'open',
    scope: 'session',
    requires: 'session',
    renderers: ['web', 'tui'],
    services: ['commands'],
    composerSlash: { name: 'skill', description: 'Search installed skills and add one to this prompt', argumentHint: '[search]' },
    keywords: ['skill'],
  }],
} as const satisfies PluginManifest
