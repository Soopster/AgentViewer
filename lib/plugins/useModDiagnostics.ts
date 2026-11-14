import { useSyncExternalStore } from 'react'
import { modDiagnosticsVersion, readModDiagnostics, subscribeModDiagnostics } from './modDiagnostics'
export function useModDiagnostics() {
  useSyncExternalStore(subscribeModDiagnostics, modDiagnosticsVersion, modDiagnosticsVersion)
  return readModDiagnostics()
}
