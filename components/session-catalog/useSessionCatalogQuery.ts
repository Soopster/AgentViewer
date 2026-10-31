import { useEffect } from 'react'
import type { SessionCatalogQuery } from './api'

type SessionCatalogBinding = {
  query: SessionCatalogQuery
  enabled: boolean
  visible: boolean
  load: (query: SessionCatalogQuery, background?: boolean) => Promise<void>
  cancel: () => void
}

export function useSessionCatalogQuery({ query, enabled, visible, load, cancel }: SessionCatalogBinding) {
  const { provider, providerInstanceId, projectDir, includeWorktrees } = query
  useEffect(() => {
    if (!enabled) return
    void load({ provider, providerInstanceId, projectDir, includeWorktrees })
    return cancel
  }, [provider, providerInstanceId, projectDir, includeWorktrees, enabled, load, cancel])

  useEffect(() => {
    if (!enabled || !visible) return
    const timer = window.setInterval(() => {
      void load({ provider, providerInstanceId, projectDir, includeWorktrees }, true)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [provider, providerInstanceId, projectDir, includeWorktrees, enabled, visible, load])
}
