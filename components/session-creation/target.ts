import type { AgentProvider, ProviderSelection, Session } from '@/lib/types'

export type SessionCreationTarget = { provider: AgentProvider; providerInstanceId: string; cwd?: string }
export function sessionCreationTarget({ provider, providerInstanceId, session, projectDir }: {
  provider: ProviderSelection; providerInstanceId: string; session: Session | null; projectDir: string | null
}): SessionCreationTarget {
  const activeProvider = provider === 'all' ? session?.provider ?? 'claude' : provider
  return {
    provider: activeProvider,
    providerInstanceId: provider === 'all' ? session?.providerInstanceId ?? activeProvider : providerInstanceId,
    cwd: projectDir ?? session?.cwd,
  }
}
