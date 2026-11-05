import { measureAsync } from '@/lib/clientPerf'
import { readJsonResponse } from '@/lib/httpResponse'
import type { SessionIdentity } from '@/lib/sessionIdentity'
import type { ProviderSelection, Session } from '@/lib/types'

export type SessionCatalogQuery = {
  provider: ProviderSelection
  providerInstanceId: string
  projectDir: string | null
  includeWorktrees: boolean
}

export function sessionCatalogQueryKey(query: SessionCatalogQuery): string {
  return JSON.stringify([query.provider, query.provider === 'all' ? null : query.providerInstanceId,
    query.projectDir, query.projectDir ? query.includeWorktrees : null])
}

export async function fetchSessionCatalog(query: SessionCatalogQuery, signal: AbortSignal): Promise<Session[]> {
  const params = new URLSearchParams({ provider: query.provider, limit: '500' })
  if (query.provider !== 'all') params.set('providerInstanceId', query.providerInstanceId)
  if (query.projectDir) {
    params.set('dir', query.projectDir)
    params.set('includeWorktrees', String(query.includeWorktrees))
  }
  const data = await measureAsync('fetch.sessions', async () => {
    const response = await fetch(`/api/sessions?${params}`, { signal })
    return readJsonResponse<{ sessions?: Session[]; error?: string }>(response)
  })
  if (data.error) throw new Error(data.error)
  return data.sessions ?? []
}

/** An action completed for another runtime must not invalidate this query. */
export function catalogIncludesSessionInstance(query: SessionCatalogQuery, target: SessionIdentity): boolean {
  if (query.provider === 'all') return true
  const provider = target.provider ?? 'claude'
  return query.provider === provider && query.providerInstanceId === (target.providerInstanceId ?? provider)
}
