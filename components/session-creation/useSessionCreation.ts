import { useCallback, useEffect, useRef, useState } from 'react'
import { beginProviderLoading } from '@/lib/providerLoading'
import { isAgentProvider } from '@/lib/provider'
import type { Session } from '@/lib/types'
import type { SessionCreationTarget } from './target'

type CreationRequest = { abort: AbortController; finishLoading: () => void }

/** Owns creation I/O and provider startup tracking. The caller decides whether
 * the resulting session should take focus or be retained in the background. */
export function useSessionCreation() {
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef<CreationRequest | null>(null)
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current?.abort.abort()
      requestRef.current?.finishLoading()
      requestRef.current = null
    }
  }, [])
  const clearError = useCallback(() => setError(null), [])
  const create = useCallback(async (target: SessionCreationTarget, intent: { isCurrent: () => boolean }): Promise<Session | null> => {
    if (!mountedRef.current || requestRef.current) return null
    const request: CreationRequest = { abort: new AbortController(), finishLoading: beginProviderLoading(target.provider) }
    requestRef.current = request
    setCreating(true)
    setError(null)
    try {
      const response = await fetch('/api/sessions/new', {
        method: 'POST', signal: request.abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
      })
      const data = await response.json() as {
        sessionId?: unknown; provider?: unknown; providerInstanceId?: unknown; cwd?: unknown; isPending?: boolean; error?: string
      }
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
      if (request.abort.signal.aborted || requestRef.current !== request) return null
      if (typeof data.sessionId !== 'string' || !data.sessionId) throw new Error('Session creation did not return a session ID.')
      const now = Date.now()
      return {
        sessionId: data.sessionId,
        provider: isAgentProvider(data.provider) ? data.provider : target.provider,
        providerInstanceId: typeof data.providerInstanceId === 'string' ? data.providerInstanceId : target.providerInstanceId,
        cwd: typeof data.cwd === 'string' ? data.cwd : target.cwd,
        createdAt: now, lastModified: now, summary: 'New session', isPending: data.isPending === true,
      }
    } catch (cause) {
      if (!request.abort.signal.aborted && requestRef.current === request && intent.isCurrent()) {
        setError(cause instanceof Error ? cause.message : 'Failed to create session')
      }
      return null
    } finally {
      request.finishLoading()
      if (requestRef.current === request) {
        requestRef.current = null
        // eslint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- inside finally; unmount removes ownership before any late completion
        setCreating(false)
      }
    }
  }, [])
  return { creating, error, clearError, create }
}
