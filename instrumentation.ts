export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { startParentWatchdog } = await import('./lib/parentWatchdog')
    startParentWatchdog('web')
  } catch (err) {
    console.warn('[instrumentation] parent watchdog failed to start:', err)
  }
  try {
    // Opt-in RSS/heap + cache-size logger (AGENT_VIEWER_MEM_LOG=1). No-op otherwise.
    const { startMemoryLogger } = await import('./lib/memoryLogger')
    startMemoryLogger()
    // Start continuous event-loop-delay + GC monitors when diagnostics are on so
    // the /api/diagnostics/runtime endpoint and the logger have data to report.
    const { diagnosticsEnabled, initTelemetry } = await import('./lib/telemetry')
    if (diagnosticsEnabled()) initTelemetry()
  } catch (err) {
    console.warn('[instrumentation] telemetry failed to start:', err)
  }
  try {
    // Prime the WarmQuery slot used by readClaudeSupportedModels. This
    // captures the pre-spawned subprocess returned by startup() so the
    // first model-list read skips the spawn cost (~1–3s). It also covers
    // the module-load / preload work the previous bare `await startup()`
    // call did, so we're not losing anything by switching.
    const { primeReadModelsWarmQuery } = await import('./lib/sdkControlQuery')
    primeReadModelsWarmQuery()
  } catch (err) {
    console.warn('[instrumentation] Claude SDK startup() failed:', err)
  }
}
