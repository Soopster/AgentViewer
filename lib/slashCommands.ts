import type { AgentProvider } from './types'

export type SlashCommandSuggestion = {
  command: string
  description: string
  argumentHint?: string
}

// Per-provider fallback slash command catalogs. These mirror what each
// provider's own CLI shows in its in-line slash menu, so the composer feels
// native even when the SDK can't enumerate commands itself. Live results from
// the SDK (when available) are merged on top so they always win.
export const SLASH_COMMANDS_BY_PROVIDER: Record<AgentProvider, SlashCommandSuggestion[]> = {
  claude: [
    { command: '/help', description: 'Show available commands' },
    { command: '/clear', description: 'Start a fresh conversation' },
    { command: '/compact', description: 'Compact the conversation history', argumentHint: '[instructions]' },
    { command: '/model', description: 'Switch the active model', argumentHint: '[model]' },
    { command: '/agents', description: 'Manage subagents' },
    { command: '/permissions', description: 'Review or change tool permissions' },
    { command: '/memory', description: 'Edit Claude memory files' },
    { command: '/mcp', description: 'Manage MCP servers' },
    { command: '/skills', description: 'List available skills' },
    { command: '/review', description: 'Review the current diff', argumentHint: '[target]' },
    { command: '/init', description: 'Generate a CLAUDE.md for this project' },
    { command: '/cost', description: 'Show cost and token usage' },
    { command: '/doctor', description: 'Diagnose your environment' },
    { command: '/login', description: 'Sign in to Claude' },
    { command: '/logout', description: 'Sign out of Claude' },
    { command: '/release-notes', description: 'Show recent release notes' },
    { command: '/upgrade', description: 'Upgrade Claude Code' },
  ],
  codex: [
    { command: '/help', description: 'List commands' },
    { command: '/clear', description: 'Reset the conversation' },
    { command: '/diff', description: 'Show pending changes' },
    { command: '/status', description: 'Show session status' },
    { command: '/model', description: 'Switch the active model', argumentHint: '[model]' },
    { command: '/compact', description: 'Compact conversation history' },
    { command: '/init', description: 'Generate an AGENTS.md for this project' },
    { command: '/cwd', description: 'Show or change working directory', argumentHint: '[path]' },
    { command: '/approvals', description: 'Review pending approvals' },
    { command: '/skills', description: 'List available skills' },
    { command: '/mention', description: 'Mention a file or app', argumentHint: '[path|app]' },
    { command: '/quit', description: 'Exit codex' },
  ],
  opencode: [
    { command: '/help', description: 'List commands' },
    { command: '/clear', description: 'Clear the conversation' },
    { command: '/summarize', description: 'Summarize the session' },
    { command: '/compact', description: 'Compact conversation history' },
    { command: '/share', description: 'Share this session via URL' },
    { command: '/unshare', description: 'Revoke the shared URL' },
    { command: '/init', description: 'Generate an opencode.md for this project' },
    { command: '/models', description: 'Browse or switch models' },
    { command: '/agents', description: 'Manage subagents' },
    { command: '/themes', description: 'Switch the TUI theme' },
    { command: '/exit', description: 'Exit opencode' },
  ],
  copilot: [
    { command: '/help', description: 'List commands' },
    { command: '/clear', description: 'Clear conversation context' },
    { command: '/model', description: 'Switch the active model', argumentHint: '[model]' },
    { command: '/login', description: 'Sign in to GitHub Copilot' },
    { command: '/logout', description: 'Sign out of GitHub Copilot' },
    { command: '/feedback', description: 'Send feedback to GitHub' },
  ],
  pi: [
    { command: '/help', description: 'Show available actions' },
    { command: '/clear', description: 'Reset the conversation' },
    { command: '/compact', description: 'Compact conversation history' },
    { command: '/model', description: 'Switch the active model', argumentHint: '[model]' },
    { command: '/thinking', description: 'Change thinking effort', argumentHint: '[low|medium|high]' },
    { command: '/skills', description: 'List available skills' },
    { command: '/init', description: 'Generate a PI.md for this project' },
    { command: '/exit', description: 'Exit Pi' },
  ],
}

export function getSlashCommandSuggestions(provider: AgentProvider | undefined | null): SlashCommandSuggestion[] {
  if (!provider) return SLASH_COMMANDS_BY_PROVIDER.claude
  return SLASH_COMMANDS_BY_PROVIDER[provider] ?? SLASH_COMMANDS_BY_PROVIDER.claude
}

export function filterSlashCommands(entries: SlashCommandSuggestion[], rawQuery: string): SlashCommandSuggestion[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return entries
  return entries.filter((entry) => entry.command.toLowerCase().includes(query) || entry.description.toLowerCase().includes(query))
}
