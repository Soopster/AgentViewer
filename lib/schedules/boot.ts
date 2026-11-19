/**
 * Starts this process's share of the schedules: register what plugins declare, then run
 * the engine (which fires only while this process holds the lease). Deferred, so it is
 * never on a boot path and a failure here cannot stop the host starting.
 */
export function bootSchedules(options: { delayMs?: number } = {}): void {
  if (process.env.AGENT_VIEWER_SCHEDULES === '0') return
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const [{ PLUGIN_MANIFESTS }, { syncDeclaredSchedules }, { ensureScheduleEngine }] = await Promise.all([
          import('../plugins/catalog'),
          import('./declared'),
          import('./engine'),
        ])
        syncDeclaredSchedules(PLUGIN_MANIFESTS)
        ensureScheduleEngine()
      } catch (error) {
        console.warn('[schedules] could not start:', error instanceof Error ? error.message : error)
      }
    })()
  }, options.delayMs ?? 0)
  timer.unref?.()
}
