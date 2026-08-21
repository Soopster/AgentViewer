import type { AgentProvider, ProviderSelection, SessionCapabilities } from './types'

const CLAUDE_CAPABILITIES: SessionCapabilities = {
  messageFork: true,
  resumeAtMessage: true,
  fileRewind: true,
  rollback: false,
  deleteSession: true,
  shareSession: false,
  unshareSession: false,
  summarizeSession: false,
  unrevertSession: false,
  respondToPermission: true,
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
  respondToPermission: true,
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
  deleteSession: true,
  shareSession: false,
  unshareSession: false,
  summarizeSession: true,
  unrevertSession: false,
  respondToPermission: true,
}

export const LMSTUDIO_CAPABILITIES: SessionCapabilities = {
  messageFork: false,
  resumeAtMessage: false,
  fileRewind: false,
  rollback: false,
  deleteSession: true,
  shareSession: false,
  unshareSession: false,
  summarizeSession: false,
  unrevertSession: false,
  respondToPermission: false,
}

// ACP-transport sessions: driven via an external claude-agent-acp/codex-acp
// subprocess (see lib/acpClientPool.ts) instead of the native SDK. ACP has no
// fork/resume-partial/rewind/rollback/delete/share RPCs, so those all stay
// false regardless of what the underlying native provider supports.
export const CLAUDE_ACP_CAPABILITIES: SessionCapabilities = {
  messageFork: false,
  resumeAtMessage: false,
  fileRewind: false,
  rollback: false,
  deleteSession: false,
  shareSession: false,
  unshareSession: false,
  summarizeSession: false,
  unrevertSession: false,
  respondToPermission: true,
}

export const CODEX_ACP_CAPABILITIES: SessionCapabilities = {
  ...CLAUDE_ACP_CAPABILITIES,
}

export function getProviderCapabilities(provider: AgentProvider): SessionCapabilities {
  if (provider === 'codex') return CODEX_CAPABILITIES
  if (provider === 'opencode') return OPENCODE_CAPABILITIES
  if (provider === 'copilot') return COPILOT_CAPABILITIES
  if (provider === 'pi') return PI_CAPABILITIES
  if (provider === 'lmstudio') return LMSTUDIO_CAPABILITIES
  if (provider === 'claude-acp') return CLAUDE_ACP_CAPABILITIES
  if (provider === 'codex-acp') return CODEX_ACP_CAPABILITIES
  return CLAUDE_CAPABILITIES
}

export function getAssistantLabel(provider: AgentProvider | undefined): string {
  if (provider === 'codex') return 'CODEX'
  if (provider === 'opencode') return 'OPENCODE'
  if (provider === 'copilot') return 'COPILOT'
  if (provider === 'pi') return 'PI'
  if (provider === 'lmstudio') return 'LM STUDIO'
  if (provider === 'claude-acp') return 'CLAUDE (ACP)'
  if (provider === 'codex-acp') return 'CODEX (ACP)'
  return 'CLAUDE'
}

export function isAgentProvider(value: unknown): value is AgentProvider {
  return (
    value === 'claude' ||
    value === 'codex' ||
    value === 'opencode' ||
    value === 'copilot' ||
    value === 'pi' ||
    value === 'lmstudio' ||
    value === 'claude-acp' ||
    value === 'codex-acp'
  )
}

export function isProviderSelection(value: unknown): value is ProviderSelection {
  return value === 'all' || isAgentProvider(value)
}
