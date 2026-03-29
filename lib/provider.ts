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

export function getProviderCapabilities(provider: AgentProvider): SessionCapabilities {
  return provider === 'codex' ? CODEX_CAPABILITIES : CLAUDE_CAPABILITIES
}

export function getAssistantLabel(provider: AgentProvider | undefined): string {
  return provider === 'codex' ? 'CODEX' : 'CLAUDE'
}
