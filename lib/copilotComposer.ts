// Copilot composer vocabularies and the small parsers that turn its loosely
// typed RPC replies into them. Shared by the Copilot adapter and the send path.
//
// The parsers exist because Copilot's mode RPC has returned both a bare string
// and a `{ mode }` envelope across SDK versions; accepting either keeps a
// version bump from silently resetting the composer to INTERACTIVE.

import type { ContextTier as CopilotContextTier, MessageOptions as CopilotMessageOptions } from '@github/copilot-sdk'
import type { SessionComposerOptions } from './types'

export type CopilotAgentMode = NonNullable<CopilotMessageOptions['agentMode']>
export type CopilotPersistentMode = Exclude<CopilotAgentMode, 'shell'>

export const COPILOT_COMPOSER_MODES = [
  {
    value: 'interactive',
    label: 'INTERACTIVE',
    description: 'Respond conversationally and make changes as needed.',
  },
  {
    value: 'plan',
    label: 'PLAN',
    description: 'Prepare a plan before changing files.',
  },
  {
    value: 'autopilot',
    label: 'AUTOPILOT',
    description: 'Work autonomously toward task completion.',
  },
  {
    value: 'shell',
    label: 'SHELL',
    description: 'Use Copilot shell-focused mode for the next turn.',
  },
] satisfies NonNullable<SessionComposerOptions['modes']>

export function parseCopilotContextTier(value: unknown): CopilotContextTier | undefined {
  return value === 'default' || value === 'long_context' ? value : undefined
}

export function parseCopilotMode(value: unknown): CopilotAgentMode | undefined {
  return value === 'interactive' || value === 'plan' || value === 'autopilot' || value === 'shell'
    ? value
    : undefined
}

export function parseCopilotModeResponse(value: unknown): CopilotAgentMode | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return parseCopilotMode((value as { mode?: unknown }).mode)
  }
  return parseCopilotMode(value)
}
