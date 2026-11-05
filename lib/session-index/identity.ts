import type { AgentProvider } from '../types'

export function persistedSessionKey(provider: AgentProvider | undefined, sessionId: string, providerInstanceId?: string): string {
  return `${providerInstanceId ?? provider ?? 'claude'}:${sessionId}`
}
