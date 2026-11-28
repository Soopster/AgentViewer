import { type SlashCommandSuggestion } from '../../../lib/slashCommands'

// A TUI view, not a provider command: the web composer has no handoff, so it stays out of the shared catalog.
export const TUI_HANDOFF_COMMAND: SlashCommandSuggestion = {
  command: '/handoff',
  description: 'Continue this conversation on another provider',
  argumentHint: '<provider>',
}

export const CODEX_LIVE_ASSISTANT_UUID = 'live-codex-assistant'
export const CLAUDE_LIVE_ASSISTANT_UUID_PREFIX = 'live-claude-assistant:'
export const TUI_SLASH_HINTS: Record<string, string[]> = {
  claude: ['/sessions', '/message', '/clear', '/compact', '/help', '/model'],
  codex: ['/sessions', '/message', '/clear', '/diff', '/status', '/compact'],
  opencode: ['/sessions', '/message', '/clear', '/summarize', '/help'],
  copilot: ['/sessions', '/message', '/help', '/clear'],
  pi: ['/sessions', '/message', '/help', '/model', '/thinking', '/compact'],
}