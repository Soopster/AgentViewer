// Pi's composer vocabulary: the thinking levels the app can set and the slash
// commands it actually executes.
//
// This list is deliberately narrower than Pi's own SDK catalog, which includes
// interactive-only commands (/settings, /resume, /quit) that assume a terminal
// lifecycle AgentViewer does not have. Advertising them would offer the user
// commands that then do nothing.

export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export const PI_SLASH_COMMANDS = [
  { command: '/help', description: 'Show available AgentViewer Pi commands' },
  { command: '/model', description: 'Show or switch the active model', argumentHint: '[provider/model]' },
  { command: '/thinking', description: 'Show or change thinking effort', argumentHint: `[${PI_THINKING_LEVELS.join('|')}]` },
  { command: '/compact', description: 'Compact conversation history', argumentHint: '[instructions]' },
  { command: '/name', description: 'Set the session display name', argumentHint: '<name>' },
  { command: '/session', description: 'Show session usage and cost' },
  { command: '/reload', description: 'Reload Pi extensions, skills, prompts, settings, and context files' },
] as const
