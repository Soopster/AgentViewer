import { useSyncExternalStore } from 'react'
import type { SessionAlertMode } from '../domain/alerts'

const KEY = 'agent-viewer:session-alerts:v1'
let mode: SessionAlertMode = 'in-app'
let loaded = false
const listeners = new Set<() => void>()
function valid(value: unknown): value is SessionAlertMode { return value === 'off' || value === 'in-app' || value === 'desktop' }
export function readSessionAlertMode(): SessionAlertMode {
  if (!loaded && typeof window !== 'undefined') {
    loaded = true
    try { const stored = localStorage.getItem(KEY); if (valid(stored)) mode = stored } catch { /* keep in-memory preferences */ }
  }
  return mode
}
export function setSessionAlertMode(next: SessionAlertMode): void {
  loaded = true
  mode = next
  try { localStorage.setItem(KEY, next) } catch { /* keep in-memory preferences */ }
  for (const listener of listeners) listener()
}
export function useSessionAlertMode(): SessionAlertMode {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    const storage = (event: StorageEvent) => { if (event.key === KEY && valid(event.newValue)) setSessionAlertMode(event.newValue) }
    window.addEventListener('storage', storage)
    return () => { listeners.delete(listener); window.removeEventListener('storage', storage) }
  }, readSessionAlertMode, () => 'in-app')
}
