// Resource ownership for feature plugins. No views, SDKs or workers are imported here.
import { isPluginEnabled, subscribePluginEnablement } from './enablement'

type Cleanup = () => void
const resources = new Map<string, Set<Cleanup>>()
function safely(cleanup: Cleanup): void {
  try { cleanup() } catch (error) { console.error('Plugin resource cleanup failed:', error) }
}
export function disposePluginResources(pluginId: string): void {
  const cleanups = resources.get(pluginId)
  resources.delete(pluginId)
  for (const cleanup of [...(cleanups ?? [])]) safely(cleanup)
}
subscribePluginEnablement(() => {
  for (const id of resources.keys()) if (!isPluginEnabled(id)) disposePluginResources(id)
})

/** Own requests, timers and workers together; dispose on disable or earlier explicit release. */
export function createPluginResourceScope(pluginId: string) {
  const controller = new AbortController()
  const cleanups = new Set<Cleanup>()
  const dispose = () => {
    if (controller.signal.aborted) return
    controller.abort()
    resources.get(pluginId)?.delete(dispose)
    if (!resources.get(pluginId)?.size) resources.delete(pluginId)
    for (const cleanup of [...cleanups].reverse()) safely(cleanup)
    cleanups.clear()
  }
  if (isPluginEnabled(pluginId)) {
    let entries = resources.get(pluginId)
    if (!entries) resources.set(pluginId, entries = new Set())
    entries.add(dispose)
  } else dispose()
  return {
    signal: controller.signal,
    dispose,
    defer(cleanup: Cleanup): Cleanup {
      if (controller.signal.aborted) safely(cleanup)
      else cleanups.add(cleanup)
      return () => { cleanups.delete(cleanup) }
    },
  }
}
