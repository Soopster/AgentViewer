import type { AgentProvider } from '../../../lib/types'
import type { ProtocolAutonomy } from '../../../lib/agentProtocol'
import { isProviderEnabled } from '../../../lib/plugins/providerPlugins'

const COORD_RUN_PROVIDER_CHOICES: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'acp']
/** The run modal's providers, minus any turned off in the plugin manager. */
export function coordRunProviders(): AgentProvider[] {
  const on = COORD_RUN_PROVIDER_CHOICES.filter(isProviderEnabled)
  return on.length > 0 ? on : COORD_RUN_PROVIDER_CHOICES
}
const COORD_MODAL_FOCUS_ORDER = [
  'prompt', 'acceptance', 'nonGoals', 'manualQa', 'escalation',
  'playbook', 'playbookArgs', 'provider', 'pool', 'agents', 'tokenBudget',
  'durationBudget', 'worktrees', 'gate', 'autonomy', 'plans', 'review', 'launch',
] as const
export type CoordModalFocus = (typeof COORD_MODAL_FOCUS_ORDER)[number]
export function moveCoordModalFocus(current: CoordModalFocus, direction: 1 | -1): CoordModalFocus {
  const index = COORD_MODAL_FOCUS_ORDER.indexOf(current)
  return COORD_MODAL_FOCUS_ORDER[(index + direction + COORD_MODAL_FOCUS_ORDER.length) % COORD_MODAL_FOCUS_ORDER.length]
}
export function cycleCoordProvider(current: AgentProvider, direction: 1 | -1): AgentProvider {
  const choices = coordRunProviders()
  const index = choices.indexOf(current)
  return choices[(Math.max(index, 0) + direction + choices.length) % choices.length]
}
const COORD_AUTONOMY_LEVELS: ProtocolAutonomy[] = ['low', 'medium', 'high']
export function cycleCoordAutonomy(current: ProtocolAutonomy, direction: 1 | -1): ProtocolAutonomy {
  const index = COORD_AUTONOMY_LEVELS.indexOf(current)
  return COORD_AUTONOMY_LEVELS[(Math.max(index, 0) + direction + COORD_AUTONOMY_LEVELS.length) % COORD_AUTONOMY_LEVELS.length]
}
export function parseCoordContractLines(value: string): string[] {
  return value.split(/\r?\n|;/).map((line) => line.trim()).filter(Boolean)
}
