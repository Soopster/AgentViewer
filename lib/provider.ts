import type { AgentProvider, SessionCapabilities } from './types'

export const CLAUDE_CAPABILITIES: SessionCapabilities = {
  messageFork: true,
  resumeAtMessage: true,
  fileRewind: true,
  rollback: false,
}

export const CODEX_CAPABILITIES: SessionCapabilities = {
  messageFork: false,
  resumeAtMessage: false,
  fileRewind: false,
  rollback: true,
}

export const OPENCODE_CAPABILITIES: SessionCapabilities = {
  messageFork: true,
  resumeAtMessage: true,
  fileRewind: true,
  rollback: false,
}

export function getProviderCapabilities(provider: AgentProvider): SessionCapabilities {
  if (provider === 'codex') return CODEX_CAPABILITIES
  if (provider === 'opencode') return OPENCODE_CAPABILITIES
  return CLAUDE_CAPABILITIES
}

export function getAssistantLabel(provider: AgentProvider | undefined): string {
  if (provider === 'codex') return 'CODEX'
  if (provider === 'opencode') return 'OPENCODE'
  return 'CLAUDE'
}
