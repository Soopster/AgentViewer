import type { AgentProvider, ProviderSelection, SessionCapabilities } from './types'

export const CLAUDE_CAPABILITIES: SessionCapabilities = {
  messageFork: true,
  resumeAtMessage: true,
  fileRewind: true,
  rollback: false,
  deleteSession: true,
  shareSession: false,
  unshareSession: false,
  summarizeSession: false,
  unrevertSession: false,
  respondToPermission: false,
}

export const CODEX_CAPABILITIES: SessionCapabilities = {
  messageFork: false,
  resumeAtMessage: false,
  fileRewind: false,
  rollback: true,
  deleteSession: false,
  shareSession: false,
  unshareSession: false,
  summarizeSession: false,
  unrevertSession: false,
  respondToPermission: false,
}

export const OPENCODE_CAPABILITIES: SessionCapabilities = {
  messageFork: true,
  resumeAtMessage: true,
  fileRewind: true,
  rollback: false,
  deleteSession: true,
  shareSession: true,
  unshareSession: true,
  summarizeSession: true,
  unrevertSession: true,
  respondToPermission: true,
}

export const COPILOT_CAPABILITIES: SessionCapabilities = {
  messageFork: false,
  resumeAtMessage: false,
  fileRewind: false,
  rollback: false,
  deleteSession: true,
  shareSession: false,
  unshareSession: false,
  summarizeSession: false,
  unrevertSession: false,
  respondToPermission: true,
}

export const PI_CAPABILITIES: SessionCapabilities = {
  messageFork: true,
  resumeAtMessage: false,
  fileRewind: false,
  rollback: false,
  deleteSession: false,
  shareSession: false,
  unshareSession: false,
  summarizeSession: false,
  unrevertSession: false,
  respondToPermission: false,
}

export function getProviderCapabilities(provider: AgentProvider): SessionCapabilities {
  if (provider === 'codex') return CODEX_CAPABILITIES
  if (provider === 'opencode') return OPENCODE_CAPABILITIES
  if (provider === 'copilot') return COPILOT_CAPABILITIES
  if (provider === 'pi') return PI_CAPABILITIES
  return CLAUDE_CAPABILITIES
}

export function getAssistantLabel(provider: AgentProvider | undefined): string {
  if (provider === 'codex') return 'CODEX'
  if (provider === 'opencode') return 'OPENCODE'
  if (provider === 'copilot') return 'COPILOT'
  if (provider === 'pi') return 'PI'
  return 'CLAUDE'
}

export function isAgentProvider(value: unknown): value is AgentProvider {
  return value === 'claude' || value === 'codex' || value === 'opencode' || value === 'copilot' || value === 'pi'
}

export function isProviderSelection(value: unknown): value is ProviderSelection {
  return value === 'all' || isAgentProvider(value)
}
