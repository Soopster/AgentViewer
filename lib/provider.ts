import type { AgentProvider, ProviderSelection, SessionCapabilities } from './types'
import { getProviderManifest, PROVIDER_EXTENSIONS } from './extensions/providers/catalog'

export const CLAUDE_CAPABILITIES: SessionCapabilities = getProviderManifest('claude').capabilities
export const CODEX_CAPABILITIES: SessionCapabilities = getProviderManifest('codex').capabilities
export const OPENCODE_CAPABILITIES: SessionCapabilities = getProviderManifest('opencode').capabilities
export const COPILOT_CAPABILITIES: SessionCapabilities = getProviderManifest('copilot').capabilities
export const PI_CAPABILITIES: SessionCapabilities = getProviderManifest('pi').capabilities
export const LMSTUDIO_CAPABILITIES: SessionCapabilities = getProviderManifest('lmstudio').capabilities
export const CLAUDE_ACP_CAPABILITIES: SessionCapabilities = getProviderManifest('claude-acp').capabilities
export const CODEX_ACP_CAPABILITIES: SessionCapabilities = getProviderManifest('codex-acp').capabilities
export const CUSTOM_ACP_CAPABILITIES: SessionCapabilities = getProviderManifest('acp').capabilities

/** Every provider id driven through lib/acpClientPool.ts. */
export type AcpProvider = Extract<AgentProvider, 'claude-acp' | 'codex-acp' | 'acp'>

export function isAcpProvider(provider: unknown): provider is AcpProvider {
  return provider === 'claude-acp' || provider === 'codex-acp' || provider === 'acp'
}

export function getProviderCapabilities(provider: AgentProvider): SessionCapabilities {
  return getProviderManifest(provider).capabilities
}

export function getAssistantLabel(provider: AgentProvider | undefined): string {
  return getProviderManifest(provider ?? 'claude').assistantLabel
}

export function isAgentProvider(value: unknown): value is AgentProvider {
  return typeof value === 'string' && Object.hasOwn(PROVIDER_EXTENSIONS, value)
}

export function isProviderSelection(value: unknown): value is ProviderSelection {
  return value === 'all' || isAgentProvider(value)
}

export function getAssistantDisplayName(provider: AgentProvider | undefined): string {
  return getProviderManifest(provider ?? 'claude').displayName
}
