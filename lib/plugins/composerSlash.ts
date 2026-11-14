import type { PluginCommandInput } from './commands'
// Metadata-only composer contribution. Local slash commands run before provider
// sending, bridge routing or queueing; ordinary native commands pass through.
import { listPluginCommands, type ResolvedPluginCommand } from './catalog'
import { isPluginEnabled } from './enablement'
import type { AgentProvider } from '../types'
import type { SlashCommandSuggestion } from '../slashCommands'
import type { PluginRenderer } from './types'

export function listPluginComposerSlashCommands(renderer: PluginRenderer, provider?: AgentProvider): SlashCommandSuggestion[] {
  return eligible(renderer, provider).map(command => ({
    command: `/${command.composerSlash!.name}`,
    description: command.composerSlash!.description,
    argumentHint: command.composerSlash!.argumentHint,
  }))
}

export function matchPluginComposerSlashCommand(text: string, renderer: PluginRenderer, provider?: AgentProvider): ResolvedPluginCommand | undefined {
  const name = text.trimStart().match(/^\/([a-z][a-z0-9-]*)(?=\s|$)/i)?.[1]?.toLowerCase()
  return name ? eligible(renderer, provider).find(command => command.composerSlash!.name === name) : undefined
}

function eligible(renderer: PluginRenderer, provider?: AgentProvider): ResolvedPluginCommand[] {
  return listPluginCommands(renderer).filter(command => command.composerSlash && isPluginEnabled(command.pluginId)
    && (!command.providers || Boolean(provider && command.providers.includes(provider))))
}

export function pluginComposerSlashInput(command: ResolvedPluginCommand, draft: string): PluginCommandInput {
  return { slash: { name: command.composerSlash!.name, arguments: draft.trimStart().replace(/^\/[^\s]+\s*/, ''), draft } }
}
