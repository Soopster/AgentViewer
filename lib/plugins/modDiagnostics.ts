// Bounded diagnostics shared by server and renderer. Never store tool arguments or transcripts.
export type ModDiagnostic = { pluginId: string; contribution: string; message: string; at: number; count: number }
const errors: ModDiagnostic[] = []
let remote: readonly ModDiagnostic[] = []
let version = 0
export const modDiagnosticsVersion = () => version
export function setRemoteModDiagnostics(next: readonly ModDiagnostic[]): void {
  if (JSON.stringify(remote) === JSON.stringify(next)) return
  remote = next; version++; for (const listener of listeners) listener()
}
const listeners = new Set<() => void>()
export function recordModDiagnostic(pluginId: string, contribution: string, error: unknown): void {
  if (error instanceof Error && error.name === 'AbortError') return
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000)
  const prior = errors.findIndex(item => item.pluginId === pluginId && item.contribution === contribution && item.message === message)
  const count = prior < 0 ? 1 : errors.splice(prior, 1)[0].count + 1
  errors.push({ pluginId, contribution, message, at: Date.now(), count })
  if (errors.length > 50) errors.shift()
  version++
  for (const listener of listeners) listener()
}
export function readLocalModDiagnostics(): readonly ModDiagnostic[] { return errors.slice() }
export function readModDiagnostics(): readonly ModDiagnostic[] { return [...errors, ...remote].slice(-50) }
export function subscribeModDiagnostics(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
