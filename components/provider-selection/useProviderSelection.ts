import { useCallback, useEffect, useRef, useState } from 'react'
import { readJsonResponse } from '@/lib/httpResponse'
import { isProviderSelection } from '@/lib/provider'
import type { ProviderInstanceSummary, ProviderSelection } from '@/lib/types'

type ProviderTarget = { provider: ProviderSelection; providerInstanceId: string }
type ProviderResponse = {
  provider?: unknown
  providerInstanceId?: unknown
  instances?: ProviderInstanceSummary[]
  error?: string
}
const DEFAULT_TARGET: ProviderTarget = { provider: 'claude', providerInstanceId: 'claude' }
function targetFor(provider: ProviderSelection, instance?: string): ProviderTarget {
  return { provider, providerInstanceId: provider === 'all' ? 'all' : instance ?? provider }
}
function sameTarget(a: ProviderTarget, b: ProviderTarget): boolean {
  return a.provider === b.provider && a.providerInstanceId === b.providerInstanceId
}

/** Restores the persisted default once; session navigation may adopt a local
 * target without persisting it. Only the latest navigation intent may publish
 * a response. Persisted switches remain serialized even after local navigation
 * supersedes their UI result, since aborting HTTP cannot undo a server write. */
export function useProviderSelection() {
  const [target, setTarget] = useState(DEFAULT_TARGET)
  const [instances, setInstances] = useState<ProviderInstanceSummary[]>([])
  const [ready, setReady] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const targetRef = useRef(DEFAULT_TARGET)
  const intentRef = useRef(0)
  const mountedRef = useRef(false)
  const bootstrapRef = useRef<AbortController | null>(null)
  const switchRef = useRef<AbortController | null>(null)

  const publish = useCallback((next: ProviderTarget) => {
    if (sameTarget(targetRef.current, next)) return
    targetRef.current = next
    setTarget(next)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const intent = ++intentRef.current
    const abort = new AbortController()
    bootstrapRef.current = abort
    const current = () => !abort.signal.aborted && intentRef.current === intent
    void (async () => {
      try {
        const response = await fetch('/api/provider', { signal: abort.signal })
        const data = await readJsonResponse<ProviderResponse>(response)
        if (data.error) throw new Error(data.error)
        if (abort.signal.aborted) return
        // Instance discovery remains useful after a local navigation has
        // superseded restoration of the default selection.
        setInstances(Array.isArray(data.instances) ? data.instances : [])
        if (current()) {
          const provider = isProviderSelection(data.provider) ? data.provider : 'claude'
          publish(targetFor(provider, typeof data.providerInstanceId === 'string' ? data.providerInstanceId : undefined))
        }
      } catch (cause) {
        if (current()) setError(cause instanceof Error ? cause.message : 'Failed to load provider')
      } finally {
        if (bootstrapRef.current === abort) bootstrapRef.current = null
        if (current()) setReady(true)
      }
    })()
    return () => {
      mountedRef.current = false
      abort.abort()
      switchRef.current?.abort()
      switchRef.current = null
    }
  }, [publish])

  const adopt = useCallback((provider: ProviderSelection, instance?: string) => {
    if (!mountedRef.current) return
    intentRef.current++
    publish(targetFor(provider, instance))
    setReady(true)
    setError(null)
  }, [publish])

  const select = useCallback(async (provider: ProviderSelection, instance?: string): Promise<boolean> => {
    if (!mountedRef.current || switchRef.current) return false
    const next = targetFor(provider, instance)
    if (sameTarget(targetRef.current, next) && !bootstrapRef.current) return false
    const intent = ++intentRef.current
    const abort = new AbortController()
    switchRef.current = abort
    const current = () => mountedRef.current && !abort.signal.aborted && intentRef.current === intent
    setSwitching(true)
    setError(null)
    try {
      const response = await fetch('/api/provider', {
        method: 'PATCH', signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...(provider !== 'all' ? { providerInstanceId: next.providerInstanceId } : {}) }),
      })
      const data = await readJsonResponse<ProviderResponse>(response)
      if (data.error) throw new Error(data.error)
      if (!current()) return false
      publish(next)
      return true
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : 'Failed to switch provider')
      return false
    } finally {
      if (switchRef.current === abort) {
        switchRef.current = null
        if (mountedRef.current) setSwitching(false)
      }
      if (current()) setReady(true)
    }
  }, [publish])

  const currentTarget = useCallback(() => ({ ...targetRef.current }), [])

  return { currentTarget, ...target, instances, ready, switching, error, adopt, select }
}
