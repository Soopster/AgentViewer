import { createLazyRegistry } from '../extensions/lazyRegistry'
import { holdDelivery } from './deliveryGate'
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
            const services: PluginApplicationServices = { ...(declared.includes('repository') && offered.repository ? { repository: { readGit: cwd => offered.repository!.readGit(cwd), readProof: (cwd, signal) => offered.repository!.readProof(cwd, signal) } } : {}), ...(declared.includes('permissions') && offered.permissions ? { permissions: { respond: (target, id, response) => current.scope.signal.aborted ? Promise.reject(new Error('Plugin deactivated')) : offered.permissions!.respond(target, id, response), answer: (target, id, answers) => current.scope.signal.aborted ? Promise.reject(new Error('Plugin deactivated')) : offered.permissions!.answer(target, id, answers) } } : {}), ...(declared.includes('activity') && offered.activity ? { activity: { publish: input => { if (!current.scope.signal.aborted) offered.activity!.publish(input) }, remove: offered.activity.remove, removeSource: offered.activity.removeSource, replaceSource: (source, items) => { if (!current.scope.signal.aborted) offered.activity!.replaceSource(source, items) } } } : {}), ...(notifications ? { notifications: {
              show: (kind, text, options) => current.scope.signal.aborted ? '' : notifications.show(kind, text, options),
              dismiss: id => { if (!current.scope.signal.aborted) notifications.dismiss(id) },
              // Every plugin's notices and desktop notifications pass the delivery gate (a focus block).
              notice: (text, options) => { if (!current.scope.signal.aborted && !holdDelivery({ channel: 'notice', urgent: options?.urgent === true, title: text, target: options?.target, source: manifest.id })) notifications.notice(text) },
              desktop: (title, body, options) => { if (!current.scope.signal.aborted && !holdDelivery({ channel: 'desktop', urgent: options?.urgent === true, title, detail: body, target: options?.target, source: manifest.id })) notifications.desktop(title, body) },
            } } : {}), ...(declared.includes('focus') && offered.focus ? { focus: offered.focus } : {}), ...(declared.includes('ide') && offered.ide ? { ide: offered.ide } : {}) }
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
  return Object.freeze({ ...snapshot, activity: new Map(snapshot.activity), sessions: snapshot.sessions.map(session => Object.freeze({ ...session, ...(session.target ? { target: Object.freeze({ ...session.target }) } : {}) })),
    ...(snapshot.cwd !== undefined ? { cwd: snapshot.cwd } : {}), ...(snapshot.teams ? { teams: new Map(snapshot.teams) } : {}), ...(snapshot.started ? { started: new Map(snapshot.started) } : {}),
    ...(snapshot.pending ? { pending: new Map([...snapshot.pending].map(([key, asks]) => [key, Object.freeze([...asks])])) } : {}) })
}

function assertSynchronous(value: unknown, id: string): void {
  if (value && typeof (value as { then?: unknown }).then === 'function') {
    // Invalid async handlers still need their rejection observed before isolation.
    void Promise.resolve(value).catch(() => {})
    throw new Error(`Plugin ${id} application callbacks must be synchronous; own async work with signal/defer`)
  }
}
