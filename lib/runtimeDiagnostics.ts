// globalThis-backed registry of memory-size reporters. Modules that own
// long-lived caches register a reporter at load; the periodic logger (which
// Next.js may run in a DIFFERENT module instance than the route handlers)
// collects from the shared global registry, so the closures capture the
// route-instance caches that actually grow. Without this the logger reports
// its own empty copies. Same rationale as globalThis.__claudePool.

type DiagnosticsReporter = () => Record<string, number>

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerDiagReporters: Set<DiagnosticsReporter> | undefined
}

function registry(): Set<DiagnosticsReporter> {
  return (globalThis.__agentViewerDiagReporters ??= new Set())
}

export function registerDiagnosticsReporter(reporter: DiagnosticsReporter): void {
  registry().add(reporter)
}

export function collectRuntimeDiagnostics(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const reporter of registry()) {
    try {
      Object.assign(out, reporter())
    } catch {
      /* a reporter throwing must not break the whole dump */
    }
  }
  return out
}
