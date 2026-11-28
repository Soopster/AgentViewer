import { getCodexClient } from '../codexClient'
import type { ThreadSearchResult } from '../codex-schema/v2'
import { listProviderInstances, withProviderInstance } from '../providerInstances'
import { searchPersistedSessions } from '../sessionPersistence'
import type { PersistedSearchParams, PersistedSearchResponse, PersistedSearchResult } from './types'

function codexSearchRow({ thread, snippet }: ThreadSearchResult, instanceId: string): PersistedSearchResult {
  return {
    score: 0,
    matches: [],
    nativeSnippet: snippet,
    session: {
      key: `${instanceId}:${thread.id}`,
      sessionId: thread.id,
      provider: 'codex',
      cwd: thread.cwd,
      title: thread.name || thread.preview || thread.id,
      summary: thread.preview || undefined,
      lastModified: thread.updatedAt * 1000,
      createdAt: thread.createdAt * 1000,
      messageCount: 0, userMessages: 0, assistantMessages: 0, systemMessages: 0,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      firstMessageAt: null, lastMessageAt: null, indexedAt: 0,
    },
  }
}

/** The index owns facets and ordering. Unfiltered text searches also get native
 * Codex hits, including sessions the index has not seen yet. */
export async function searchSessionsProgressively(
  params: PersistedSearchParams,
  signal: AbortSignal,
  onPartial: (result: PersistedSearchResponse) => void,
): Promise<PersistedSearchResponse> {
  const query = params.query.trim()
  const indexRequest = searchPersistedSessions(params)
  if (!query || new TextEncoder().encode(query).length > 65_536
    || (params.provider && params.provider !== 'all' && params.provider !== 'codex')
    || params.dir || params.sinceMs != null || params.untilMs != null
    || params.hasError || params.touchedFile || params.role || params.toolName || params.messagesOnly) {
    return indexRequest
  }

  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100)
  const native = new Map<string, Map<string, PersistedSearchResult>>()
  let indexed: PersistedSearchResponse | undefined
  const merge = (): PersistedSearchResponse => {
    const indexRows = indexed?.results ?? []
    const seen = new Set(indexRows.map(row => row.session.key))
    const nativeRows = [...native.values()].flatMap(rows => [...rows.values()])
      .filter(row => !seen.has(row.session.key))
      .sort((a, b) => (b.session.lastModified ?? 0) - (a.session.lastModified ?? 0))
      .slice(0, limit)
    return { query, total: (indexed?.total ?? 0) + nativeRows.length, results: [...indexRows, ...nativeRows] }
  }
  const publish = () => { if (!signal.aborted) onPartial(merge()) }
  const searchSignal = AbortSignal.any([signal, AbortSignal.timeout(3_000)])
  const nativeRequest = listProviderInstances().then(instances => Promise.all(
    instances.filter(instance => instance.provider === 'codex').map(async instance => {
      const rows = new Map<string, PersistedSearchResult>()
      native.set(instance.id, rows)
      const add = (data: ThreadSearchResult[]) => {
        for (const item of data) {
          if (!item?.thread?.id || item.thread.ephemeral || rows.size >= limit) continue
          const row = codexSearchRow(item, instance.id)
          rows.set(row.session.key, row)
        }
        publish()
      }
      try {
        const result = await withProviderInstance(instance.id, 'codex', () => getCodexClient().searchThreads({
          searchTerm: query, limit, sortKey: 'updated_at', includeAttachedThreads: true,
          sourceKinds: ['cli', 'vscode', 'appServer', 'exec', 'subAgentThreadSpawn'],
          currentAccountOnly: true,
        }, searchSignal, add))
        rows.clear()
        add(result.data)
      } catch {
        // Older app servers, disabled runtimes and timeouts leave index results available.
        rows.clear()
        publish()
      }
    }),
  )).catch(() => {})
  const [index] = await Promise.allSettled([
    indexRequest.then(response => { indexed = response; publish() }),
    nativeRequest,
  ])
  signal.throwIfAborted()
  const result = merge()
  if (index.status === 'rejected' && result.results.length === 0) throw index.reason
  return result
}
