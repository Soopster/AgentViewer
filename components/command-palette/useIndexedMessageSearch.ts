'use client'

import { useState, useEffect, useCallback } from 'react'
import type { PersistedSearchResult } from '@/lib/sessionPersistence'
import type { IndexedSearchResponse, IndexRebuildResponse, IndexRebuildState } from './types'
import { MESSAGE_SEARCH_SESSION_LIMIT } from './searchModel'

type SearchOptions = {
  open: boolean
  query: string
  includeWorktrees: boolean
  scopeMode: 'all' | 'project'
  selectedProjectDir?: string
  selectedSessionCwd?: string
}

/** Owns debounced index requests and rebuild status; callers own query input and selection. */
export function useIndexedMessageSearch({ open, query: deferredQuery, includeWorktrees, scopeMode, selectedProjectDir, selectedSessionCwd }: SearchOptions) {
  const normalizedQuery = deferredQuery.trim().toLowerCase()
  const [indexedResults, setIndexedResults] = useState<PersistedSearchResult[]>([])
  const [indexedLoading, setIndexedLoading] = useState(false)
  const [indexRebuild, setIndexRebuild] = useState<IndexRebuildState>({ status: 'idle' })

  useEffect(() => {
    if (!open || normalizedQuery.length < 2) {
      setIndexedResults([])
      setIndexedLoading(false)
      return
    }

    const controller = new AbortController()
    setIndexedLoading(true)
    setIndexedResults([])
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams()
      params.set('q', deferredQuery.trim())
      params.set('limit', String(MESSAGE_SEARCH_SESSION_LIMIT))
      params.set('provider', 'all')
      params.set('includeWorktrees', String(includeWorktrees))
      params.set('messagesOnly', '1')
      const searchDir = scopeMode === 'project'
        ? selectedProjectDir ?? selectedSessionCwd
        : undefined
      if (searchDir) params.set('dir', searchDir)

      try {
        const response = await fetch(`/api/session-index/search?${params.toString()}`, {
          signal: controller.signal,
        })
        const data = await response.json() as IndexedSearchResponse & { error?: string }
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
        setIndexedResults(data.results ?? [])
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setIndexedResults([])
        }
      } finally {
        if (!controller.signal.aborted) setIndexedLoading(false)
      }
    }, 160)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [deferredQuery, includeWorktrees, normalizedQuery.length, open, scopeMode, selectedProjectDir, selectedSessionCwd])

  const rebuildSearchIndex = useCallback(async () => {
    if (indexRebuild.status === 'running') return
    setIndexRebuild({ status: 'running', message: 'Scanning all providers...' })
    try {
      const response = await fetch('/api/session-index/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'all', includeWorktrees: true }),
      })
      const data = await response.json() as IndexRebuildResponse & { error?: string }
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
      const errorCount = data.errors?.length ?? 0
      setIndexedResults([])
      setIndexRebuild({
        status: errorCount > 0 ? 'error' : 'done',
        message: `${data.sessions} sessions · ${data.messages} messages${errorCount > 0 ? ` · ${errorCount} errors` : ''}`,
      })
    } catch (err) {
      setIndexRebuild({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to rebuild index',
      })
    }
  }, [indexRebuild.status])

  return { indexedResults, indexedLoading, indexRebuild, rebuildSearchIndex }
}
