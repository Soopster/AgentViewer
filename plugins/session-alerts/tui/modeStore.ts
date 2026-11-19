// The session-alerts mode, kept in tui.json and read on first use (a preference is not a boot cost).
import { useSyncExternalStore } from 'react'
import { getConfiguredTuiSessionAlerts, setConfiguredTuiSessionAlerts } from '../../../lib/tuiState'
import type { SessionAlertMode } from '../domain/alerts'

let mode: SessionAlertMode = 'desktop'
let loaded: Promise<void> | null = null
let chosen = false
let ready = false
const listeners = new Set<() => void>()

function commit(next: SessionAlertMode): void {
  mode = next
  for (const listener of listeners) listener()
}

export function loadSessionAlertMode(): void {
  loaded ??= getConfiguredTuiSessionAlerts().then((value) => { if (!chosen) commit(value) }).catch(() => {}).finally(() => { ready = true })
}

export const hasLoadedSessionAlertMode = () => ready || chosen

export function readSessionAlertMode(): SessionAlertMode {
  return mode
}

export function subscribeSessionAlertMode(listener: () => void): () => void {
  loadSessionAlertMode()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useSessionAlertMode(): SessionAlertMode {
  return useSyncExternalStore(subscribeSessionAlertMode, readSessionAlertMode, readSessionAlertMode)
}

const ORDER: readonly SessionAlertMode[] = ['desktop', 'in-app', 'off']
export function cycleSessionAlertMode(): SessionAlertMode {
  chosen = true
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!
  commit(next)
  void setConfiguredTuiSessionAlerts(next).catch(() => {})
  return next
}
