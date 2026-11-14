import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionIdentity } from '@/lib/sessionIdentity'
import type { Session } from '@/lib/types'
import { fetchSessionCatalog, sessionCatalogQueryKey, catalogIncludesSessionInstance, type SessionCatalogQuery } from './api'
import { stabilizeSessionIdentities } from './model'

type CatalogRequest = { key: string; abort: AbortController; promise: Promise<void> }

/** Owns one catalog resource. Query binding lives in useSessionCatalogQuery so
 * navigation can derive a query from the catalog without a dependency cycle. */
export function useSessionCatalog() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef<CatalogRequest | null>(null)
  const queryRef = useRef<SessionCatalogQuery | null>(null)
  const mountedRef = useRef(false)

  const cancel = useCallback(() => {
    requestRef.current?.abort.abort()
    requestRef.current = null
    setLoading(false)
  }, [])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current?.abort.abort()
      requestRef.current = null
    }
  }, [])

  const load = useCallback((query: SessionCatalogQuery, background = false): Promise<void> => {
    if (!mountedRef.current) return Promise.resolve()
    queryRef.current = query
    const key = sessionCatalogQueryKey(query)
    if (requestRef.current?.key === key) return requestRef.current.promise
    requestRef.current?.abort.abort()
    const request: CatalogRequest = { key, abort: new AbortController(), promise: Promise.resolve() }
    requestRef.current = request
    setLoading(!background)
    if (!background) setError(null)
    request.promise = (async () => {
      try {
        const incoming = await fetchSessionCatalog(query, request.abort.signal)
        if (request.abort.signal.aborted || requestRef.current !== request) return
        setSessions(previous => stabilizeSessionIdentities(previous, incoming))
        setError(null)
      } catch (cause) {
        if (!request.abort.signal.aborted && requestRef.current === request && !background) {
          setError(cause instanceof Error ? cause.message : 'Failed to load sessions')
        }
      } finally {
        if (requestRef.current === request) {
          requestRef.current = null
          // eslint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- inside finally; only the current request may finish this load
          setLoading(false)
        }
      }
    })()
    return request.promise
  }, [])

  // Async plugin/mutation completions refresh the current query, never the
  // provider or project captured when their operation started.
  const refresh = useCallback((background = true) => queryRef.current ? load(queryRef.current, background) : Promise.resolve(), [load])

  const update = useCallback((transform: (previous: Session[]) => Session[], target?: SessionIdentity) => {
    if (!mountedRef.current) return
    if (target && queryRef.current && !catalogIncludesSessionInstance(queryRef.current, target)) return
    // A response fetched before an optimistic mutation must not undo it.
    cancel()
    setSessions(transform)
  }, [cancel])

  return { sessions, loading, error, load, cancel, update, refresh }
}
