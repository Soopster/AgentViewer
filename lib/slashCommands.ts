import type { AgentProvider } from './types'

export type SlashCommandSuggestion = {
  command: string
  description: string
}

export const SLASH_COMMANDS_BY_PROVIDER: Record<AgentProvider, SlashCommandSuggestion[]> = {
  claude: [
    { command: '/clear', description: 'Start a fresh conversation' },
    { command: '/compact', description: 'Compact the conversation history' },
    { command: '/help', description: 'Show available commands' },
    { command: '/model', description: 'Switch the active model' },
    { command: '/cost', description: 'Show cost and token usage' },
    { command: '/review', description: 'Review the current diff' },
    { command: '/init', description: 'Generate a CLAUDE.md for this project' },
  ],
  codex: [
    { command: '/clear', description: 'Reset the conversation' },
    { command: '/diff', description: 'Show pending changes' },
    { command: '/status', description: 'Show session status' },
    { command: '/compact', description: 'Compact conversation' },
  ],
  opencode: [
    { command: '/clear', description: 'Clear the conversation' },
    { command: '/summarize', description: 'Summarize the session' },
    { command: '/help', description: 'List commands' },
  ],
  copilot: [
    { command: '/help', description: 'List commands' },
    { command: '/clear', description: 'Clear conversation context' },
  ],
  pi: [
    { command: '/help', description: 'Show available actions' },
    { command: '/clear', description: 'Reset the conversation' },
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
