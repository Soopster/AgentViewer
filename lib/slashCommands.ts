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
  // Mirrors codex-rs/tui/src/slash_command.rs SlashCommand enum (order = popup order).
  // Descriptions are taken verbatim from `SlashCommand::description()` so the slash
  // menu matches what the Codex CLI shows. Argument hints come from
  // `supports_inline_args()` plus the in-CLI hint shape.
  codex: [
    { command: '/model', description: 'choose what model and reasoning effort to use', argumentHint: '[model]' },
    { command: '/ide', description: 'include current selection, open files, and other context from your IDE', argumentHint: '[context]' },
    { command: '/permissions', description: 'choose what Codex is allowed to do' },
    { command: '/keymap', description: 'remap TUI shortcuts', argumentHint: '[shortcut]' },
    { command: '/vim', description: 'toggle Vim mode for the composer' },
    { command: '/experimental', description: 'toggle experimental features' },
    { command: '/approve', description: 'approve one retry of a recent auto-review denial' },
    { command: '/memories', description: 'configure memory use and generation' },
    { command: '/skills', description: 'use skills to improve how Codex performs specific tasks' },
    { command: '/hooks', description: 'view and manage lifecycle hooks' },
    { command: '/review', description: 'review my current changes and find issues', argumentHint: '[scope]' },
    { command: '/rename', description: 'rename the current thread', argumentHint: '[title]' },
    { command: '/new', description: 'start a new chat during a conversation' },
    { command: '/resume', description: 'resume a saved chat', argumentHint: '[chat]' },
    { command: '/fork', description: 'fork the current chat' },
    { command: '/init', description: 'create an AGENTS.md file with instructions for Codex' },
    { command: '/compact', description: 'summarize conversation to prevent hitting the context limit' },
    { command: '/plan', description: 'switch to Plan mode', argumentHint: '[goal]' },
    { command: '/goal', description: 'set or view the goal for a long-running task', argumentHint: '[goal]' },
    { command: '/agent', description: 'switch the active agent thread' },
    { command: '/side', description: 'start a side conversation in an ephemeral fork', argumentHint: '[prompt]' },
    { command: '/copy', description: 'copy last response as markdown' },
    { command: '/raw', description: 'toggle raw scrollback mode for copy-friendly terminal selection', argumentHint: '[on|off]' },
    { command: '/diff', description: 'show git diff (including untracked files)' },
    { command: '/mention', description: 'mention a file' },
    { command: '/status', description: 'show current session configuration and token usage' },
    { command: '/title', description: 'configure which items appear in the terminal title' },
    { command: '/statusline', description: 'configure which items appear in the status line' },
    { command: '/theme', description: 'choose a syntax highlighting theme' },
    { command: '/mcp', description: 'list configured MCP tools; use /mcp verbose for details', argumentHint: '[verbose]' },
    { command: '/apps', description: 'manage apps' },
    { command: '/plugins', description: 'browse plugins' },
    { command: '/logout', description: 'log out of Codex' },
    { command: '/feedback', description: 'send logs to maintainers' },
    { command: '/clear', description: 'clear the terminal and start a new chat' },
    { command: '/quit', description: 'exit Codex' },
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
