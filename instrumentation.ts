export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
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
