import { createLazyRegistry } from '../extensions/lazyRegistry'
import { isPluginEnabled, subscribePluginEnablement } from './enablement'
import { createPluginResourceScope } from './lifecycle'
import { PLUGIN_API_VERSION, type PluginManifest } from './types'
import { PluginTurnBlockedError, type PluginBehaviorModule, type PluginBeforeTurnContext } from './behavior'

/** Headless plugins have a lifetime independent of their views. No work at registration. */
export function createPluginBehaviorHost(
  manifests: readonly PluginManifest[],
  loaders: Readonly<Record<string, () => Promise<PluginBehaviorModule>>>,
) {
  const contributors = manifests.filter(m => m.behavior?.hooks.includes('beforeTurn'))
    .sort((a, b) => (a.behavior?.order ?? 0) - (b.behavior?.order ?? 0) || a.id.localeCompare(b.id))
  for (const manifest of contributors) {
    if (!Object.hasOwn(loaders, manifest.id)) throw new Error(`Plugin ${manifest.id} has no behavior loader`)
  }
  const scopes = new Map<string, ReturnType<typeof createPluginResourceScope>>()
  const registry = createLazyRegistry(loaders, (id, module) => {
    if (!contributors.some(m => m.id === id && m.apiVersion === PLUGIN_API_VERSION)
      || module?.apiVersion !== PLUGIN_API_VERSION || module.pluginId !== id
      || typeof module.beforeTurn !== 'function'
      || (module.deactivate !== undefined && typeof module.deactivate !== 'function')) {
      throw new Error(`Plugin ${id} behavior API or identity mismatch`)
    }
  })
  const deactivate = (id: string) => {
    const loaded = registry.peek(id)
    registry.evict(id)
    scopes.get(id)?.dispose()
    scopes.delete(id)
    try { loaded?.deactivate?.() } catch (error) { console.error(`Plugin ${id} behavior cleanup failed:`, error) }
  }
  const unsubscribe = subscribePluginEnablement(() => {
    for (const manifest of contributors) if (!isPluginEnabled(manifest.id)) deactivate(manifest.id)
  })
  let disposed = false
  return {
    isLoaded: (id: string) => registry.peek(id) !== undefined,
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      for (const manifest of contributors) deactivate(manifest.id)
    },
    async beforeTurn(context: PluginBeforeTurnContext): Promise<Record<string, unknown>> {
      if (disposed) throw new Error('Plugin behavior host is disposed')
      context.signal.throwIfAborted()
      let body = structuredClone(context.body)
      const target = Object.freeze({ ...context.target })
      for (const manifest of contributors) {
        if (!isPluginEnabled(manifest.id)) continue
        let scope = scopes.get(manifest.id)
        if (!scope) {
          scope = createPluginResourceScope(manifest.id)
          scopes.set(manifest.id, scope)
        }
        const signal = AbortSignal.any([context.signal, scope.signal])
        const result = await abortable(signal, async () => {
          signal.throwIfAborted()
          const module = await registry.get(manifest.id)
          signal.throwIfAborted()
          return module.beforeTurn({ target, signal, body: structuredClone(body) })
        })
        signal.throwIfAborted()
        if (!result) continue
        if (result.action === 'block' && typeof result.reason === 'string' && result.reason.trim()) {
          throw new PluginTurnBlockedError(manifest.id, result.reason)
        }
        if (result.action !== 'patch' || !result.body || typeof result.body !== 'object' || Array.isArray(result.body)) {
          throw new Error(`Plugin ${manifest.id} returned an invalid beforeTurn result`)
        }
        body = { ...body, ...structuredClone(result.body) }
      }
      context.signal.throwIfAborted()
      return body
    },
  }
}

/** Cancelling/disabling doesn't wait for a hook which ignores its signal. */
function abortable<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    Promise.resolve().then(run).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}
