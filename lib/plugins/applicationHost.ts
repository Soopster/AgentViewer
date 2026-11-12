import { createLazyRegistry } from '../extensions/lazyRegistry'
import { createPluginResourceScope } from './lifecycle'
import { isPluginEnabled, subscribePluginEnablement } from './enablement'
import { PLUGIN_API_VERSION, type PluginManifest, type PluginRenderer } from './types'
import type { PluginActivitySnapshot, PluginApplicationModule, PluginApplicationServices } from './application'

export type PluginApplicationLoaders = Readonly<Record<string, () => Promise<PluginApplicationModule>>>

/** Latest-value observations: bounded while loading, serialized per plugin, isolated on failure. */
export function createPluginApplicationHost(renderer: PluginRenderer, manifests: readonly PluginManifest[], loaders: PluginApplicationLoaders,
  offered: PluginApplicationServices, onError: (id: string, error: unknown) => void = (id, error) => console.error(`Plugin ${id} observer failed:`, error)) {
  const contributors = manifests.filter(m => m.renderers.includes(renderer) && m.application?.events.includes('sessionActivity'))
  for (const manifest of contributors) if (!Object.hasOwn(loaders, manifest.id)) throw new Error(`Plugin ${manifest.id} has no ${renderer} application loader`)
  const registry = createLazyRegistry(loaders, (id, module) => {
    if (module?.apiVersion !== PLUGIN_API_VERSION || module.pluginId !== id || typeof module.activate !== 'function'
      || !contributors.some(m => m.id === id && m.apiVersion === PLUGIN_API_VERSION)) throw new Error(`Plugin ${id} application API or identity mismatch`)
  })
  type Entry = {
    scope: ReturnType<typeof createPluginResourceScope>
    observer?: ReturnType<PluginApplicationModule['activate']>
    pending?: PluginActivitySnapshot
    draining?: Promise<void>
  }
  const entries = new Map<string, Entry>()
  let disposed = false
  const deactivate = (id: string) => {
    const entry = entries.get(id)
    entries.delete(id)
    registry.evict(id)
    entry?.scope.dispose()
  }
  const publish = (snapshot: PluginActivitySnapshot): Promise<void> => {
    if (disposed) return Promise.resolve()
    // Copy at publication, before any lazy await. Callers may reuse their maps.
    const captured = copySnapshot(snapshot)
    return Promise.all(contributors.map(manifest => {
      if (!isPluginEnabled(manifest.id)) return
      let entry = entries.get(manifest.id)
      if (!entry) {
        entry = { scope: createPluginResourceScope(manifest.id) }
        entries.set(manifest.id, entry)
      }
      entry.pending = copySnapshot(captured)
      if (entry.draining) return entry.draining
      const current = entry
      current.draining = (async () => {
        try {
          const declared = manifest.application!.services
          const missing = declared.filter(id => !offered[id])
          if (missing.length) throw new Error(`Plugin ${manifest.id} needs application services: ${missing.join(', ')}`)
          current.scope.signal.throwIfAborted()
          const module = await registry.get(manifest.id)
          current.scope.signal.throwIfAborted()
          if (!current.observer) {
            const notifications = declared.includes('notifications') ? offered.notifications : undefined
            // Late completions cannot deliver notifications after this activation ends.
            const services: PluginApplicationServices = notifications ? { notifications: {
              notice: text => { if (!current.scope.signal.aborted) notifications.notice(text) },
              desktop: (title, body) => { if (!current.scope.signal.aborted) notifications.desktop(title, body) },
            } } : {}
            current.observer = module.activate({ signal: current.scope.signal, services, defer: current.scope.defer })
            assertSynchronous(current.observer, manifest.id)
            if (typeof current.observer?.onSessionActivity !== 'function') throw new Error(`Plugin ${manifest.id} has no sessionActivity observer`)
          }
          while (current.pending && !current.scope.signal.aborted && entries.get(manifest.id) === current) {
            const event = current.pending
            current.pending = undefined
            const result: unknown = current.observer.onSessionActivity(event)
            assertSynchronous(result, manifest.id)
          }
        } catch (error) {
          if (!current.scope.signal.aborted) {
            deactivate(manifest.id)
            try { onError(manifest.id, error) } catch { /* diagnostics cannot take down publication */ }
          }
        } finally { current.draining = undefined }
      })()
      return current.draining
    })).then(() => {})
  }
  const unsubscribe = subscribePluginEnablement(() => {
    for (const manifest of contributors) if (!isPluginEnabled(manifest.id)) deactivate(manifest.id)
    // Re-enable waits for a fresh source snapshot, never one cached before disablement.
  })
  return {
    publish,
    isLoaded: (id: string) => registry.peek(id) !== undefined,
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      for (const manifest of contributors) deactivate(manifest.id)
    },
  }
}

function copySnapshot(snapshot: PluginActivitySnapshot): PluginActivitySnapshot {
  return Object.freeze({ ...snapshot, activity: new Map(snapshot.activity), sessions: snapshot.sessions.map(session => Object.freeze({ ...session })) })
}

function assertSynchronous(value: unknown, id: string): void {
  if (value && typeof (value as { then?: unknown }).then === 'function') {
    // Invalid async handlers still need their rejection observed before isolation.
    void Promise.resolve(value).catch(() => {})
    throw new Error(`Plugin ${id} application callbacks must be synchronous; own async work with signal/defer`)
  }
}
