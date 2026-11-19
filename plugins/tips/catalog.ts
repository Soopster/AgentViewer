import { listPluginCommands } from '../../lib/plugins/catalog'
import { isPluginEnabled } from '../../lib/plugins/enablement'
import type { SessionIdentity } from '../../lib/sessionIdentity'
import type { PluginRenderer } from '../../lib/plugins/types'
import type { FeatureTip } from './model'

const FEATURES = [
  { id: 'goals', commands: ['goal'], detail: 'keep an agent working toward an objective with a token budget' },
  { id: 'bookmarks', commands: ['bookmark-all'], detail: 'revisit saved messages across sessions and providers' },
  { id: 'prompts', commands: ['prompt-library', 'open-prompt-library'], detail: 'reuse saved prompts with fill-in fields' },
  { id: 'skills', commands: ['skills-manager'], detail: 'browse installed skills and preview copies between locations' },
  { id: 'git', commands: ['git'], detail: 'review repository changes alongside the conversation' },
  { id: 'terminal', commands: ['processes'], detail: 'inspect dev servers, watchers and their logs beside the transcript' },
] as const

export function listFeatureTips(renderer: PluginRenderer, session: SessionIdentity, hasRepository: boolean): FeatureTip[] {
  const commands = listPluginCommands(renderer).filter(command => isPluginEnabled(command.pluginId)
    && (!command.providers || command.providers.includes(session.provider ?? 'claude'))
    && (command.requires !== 'repository' || hasRepository)
    && (hasRepository || !['git', 'terminal'].includes(command.pluginId)))
  const tips: FeatureTip[] = []
  for (const feature of FEATURES) {
    const command = commands.find(entry => (feature.commands as readonly string[]).includes(entry.id))
    if (command) tips.push({ id: feature.id, text: `Open “${command.label}” from the command palette to ${feature.detail}.` })
  }
  if (commands.some(command => command.id === 'skills-manager')) {
    tips.push({ id: 'placements', text: 'Keep Skills Manager beside your conversation by moving its view into a panel or window.' })
  }
  return tips
}
