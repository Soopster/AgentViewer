/** SDK modules register passive counters only after they have been loaded.
 * Reading diagnostics must never activate a provider or create SDK resources. */
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerProviderDiagnostics: Map<string, () => Record<string, number>> | undefined
}
const readers = globalThis.__agentViewerProviderDiagnostics ??= new Map()

export function registerProviderDiagnostics(id: string, read: () => Record<string, number>): void {
  readers.set(id, read)
}

export function readProviderDiagnostics(): Record<string, number> {
  const result: Record<string, number> = {}
  for (const read of readers.values()) {
    try { Object.assign(result, read()) } catch { /* a provider still initializing cannot block other counters */ }
  }
  return result
}
