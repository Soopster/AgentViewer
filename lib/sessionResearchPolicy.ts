// Host-owned policy for temporary research sessions. Provider adapters consult
// this before exposing tools; it never changes a user's source session.
import type { SessionIdentity } from './sessionIdentity'
import { sessionIdentityKey } from './sessionIdentity'
import { currentProviderInstanceId } from './providerInstances'
import type { AgentProvider } from './types'

const sessions = new Set<string>()
export function registerResearchSession(target: SessionIdentity): () => void {
  const key = sessionIdentityKey(target)
  sessions.add(key)
  return () => { sessions.delete(key) }
}
export function isResearchSession(target: SessionIdentity): boolean {
  return sessions.has(sessionIdentityKey(target))
}
export function hasResearchToolPolicy(provider: AgentProvider, sessionId: string): boolean {
  return isResearchSession({ provider, sessionId, providerInstanceId: currentProviderInstanceId(provider) })
}
export const RESEARCH_FILE_TOOLS = ['read', 'read_file', 'view', 'grep', 'glob', 'find', 'ls', 'list', 'list_dir'] as const
