import type { SelectOption } from '@opentui/core'
import type { ProtocolAutonomy } from '../../../lib/agentProtocol'
import { PROVIDER_IDS } from '../../../lib/extensions/providers/catalog'
import { isProviderEnabled } from '../../../lib/plugins/providerPlugins'
import type { TuiProviderInstanceChoice } from '../../../lib/tui/service'
import type { ProviderSelection, Session, AgentProvider, ReasoningEffortLevel } from '../../../lib/types'
import { formatProviderLabel } from '../../format'
import type { ModelPickerOption, TuiEffort } from './types'

const PROVIDERS: ProviderSelection[] = [...PROVIDER_IDS, 'all']
export const TUI_PROVIDER_TAG: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  copilot: 'copilot',
  pi: 'pi',
}
// Rows the picker leaves for the transcript before it starts collapsing —
// mainContentHeight's own floor, so the two agree — and the floor the picker
// will not shrink below even on a very short terminal.
export const QUESTION_PICKER_MIN_TRANSCRIPT_ROWS = 8
export const QUESTION_PICKER_MIN_ROWS = 8
// An AskUserQuestion option may carry a `preview` — an ASCII mockup, a code
// snippet, a config sample. The SDK's default `previewFormat` is markdown/ASCII
// described as "rendered in a monospace box", so the TUI is the surface it was
// authored for; the web picker already shows it behind a toggle and this one
// dropped it entirely.
//
// Only the option under the cursor gets one. Previews are multi-line by nature
// and the picker is already rationing rows, so drawing one per option would
// blow the budget on the first question. Capped, because a long preview would
// otherwise push the option list — the thing the keys act on — off the card.
export const QUESTION_PREVIEW_MAX_LINES = 8
// Label row + at least one line of content: below this there is no point
// reserving anything, so the preview is dropped instead.
export const QUESTION_PREVIEW_MIN_ROWS = 2
// A session from a further provider instance — a configured ACP agent, a second
// account — goes by the name that instance was given ("GEMINI", "WORK"); every
// other session by its provider's.
export function sessionProviderLabel(session: Pick<Session, 'provider' | 'providerInstanceId' | 'providerDisplayName'>): string {
  return session.providerDisplayName && session.providerInstanceId && session.providerInstanceId !== session.provider
    ? session.providerDisplayName.toUpperCase()
    : formatProviderLabel(session.provider ?? 'claude')
}
const PROVIDER_SELECT_OPTIONS: SelectOption[] = PROVIDERS.map((provider) => ({
  name: provider.toUpperCase(),
  description: provider === 'all' ? 'All providers' : `${provider} sessions`,
  value: provider,
}))
// A provider with further instances lists each under its own row. The bare
// provider row then means all of them; a value of `provider|instance` one.
export function providerSelectOptions(instances: readonly TuiProviderInstanceChoice[]): SelectOption[] {
  // A provider turned off in the plugin manager has no row; 'all' always has one.
  const options = PROVIDER_SELECT_OPTIONS.filter((option) => option.value === 'all' || isProviderEnabled(option.value as string))
  if (instances.length === 0) return options
  return options.flatMap((option) => [
    option,
    ...instances.filter((instance) => instance.provider === option.value).map((instance) => ({
      name: `  ${instance.label.toUpperCase()}`,
      description: `  ${option.value} · ${instance.label} only`,
      value: `${instance.provider}|${instance.providerInstanceId}`,
    })),
  ])
}
export function providerOptionIndex(options: readonly SelectOption[], provider: ProviderSelection, instanceId: string | null): number {
  const exact = options.findIndex((option) => option.value === (instanceId ? `${provider}|${instanceId}` : provider))
  return Math.max(exact >= 0 ? exact : options.findIndex((option) => option.value === provider), 0)
}
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
export function filterModelPickerOptions(options: ModelPickerOption[], query: string): ModelPickerOption[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return options
  return options.filter((option) => {
    const haystack = `${option.name} ${String(option.value ?? '')} ${option.description ?? ''}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
const EFFORT_DESCRIPTIONS: Record<TuiEffort, string> = {
  auto: 'Use the model or session default',
  off: 'Disable extended reasoning',
  minimal: 'Fastest reasoning pass',
  low: 'Light reasoning',
  medium: 'Balanced reasoning',
  high: 'Deep reasoning',
  xhigh: 'Extra-high reasoning',
  max: 'Maximum reasoning budget',
}
function effortLevelsForModel(
  provider: ProviderSelection | undefined,
  model: ModelPickerOption | undefined
): ReasoningEffortLevel[] {
  if (!provider || provider === 'all' || provider === 'opencode' || model?.supportsEffort === false) return []
  const allowed: ReasoningEffortLevel[] = provider === 'codex'
    ? ['low', 'medium', 'high']
    : provider === 'copilot'
      ? ['low', 'medium', 'high', 'xhigh']
      : ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const reported = model?.supportedEffortLevels
  if (!reported || reported.length === 0) return allowed
  return allowed.filter((level) => reported.includes(level))
}
export function effortPickerOptions(
  provider: ProviderSelection | undefined,
  model: ModelPickerOption | undefined): Array<SelectOption & { value: TuiEffort} > {
  return [
    { name: 'AUTO', value: 'auto', description: EFFORT_DESCRIPTIONS.auto },
    ...effortLevelsForModel(provider, model).map((level) => ({
      name: level === 'xhigh' ? 'XHIGH' : level.toUpperCase(),
      value: level,
      description: EFFORT_DESCRIPTIONS[level],
    })),
  ]
}
// Permission mode indicator in the composer dock — Claude Code's shift+tab style.
export const PERMISSION_MODE_GLYPH: Partial<Record<string, string>> = {
  plan: '“', // " left double quotation mark (read-only/pause)
  acceptEdits: '▶▶', // ▶▶ (auto-accept edits)
  auto: '▶▶', // ▶▶ (classifier decides)
  bypassPermissions: '▶▶', // ▶▶ (bypass all)
}
export const PERMISSION_MODE_LABEL: Partial<Record<string, string>> = {
  plan: 'plan',
  acceptEdits: 'accept edits',
  auto: 'auto',
  bypassPermissions: 'bypass',
}
