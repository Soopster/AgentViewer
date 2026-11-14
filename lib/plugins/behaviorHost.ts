import { createLazyRegistry } from '../extensions/lazyRegistry'
import { isPluginEnabled, subscribePluginEnablement } from './enablement'
import { createPluginResourceScope } from './lifecycle'
import { PLUGIN_API_VERSION, type PluginManifest } from './types'
import {
  PluginTurnBlockedError,
  type PluginAfterTurnContext,
  type PluginAfterTurnResult,
  type PluginBehaviorHook,
  type PluginBehaviorModule,
  type PluginBeforeTurnContext,
  type PluginPermissionRequest,
  type PluginToolCardContext,
  type PluginTurnTarget,
  PLUGIN_PERMISSION_TIMEOUT_MS,
} from './behavior'

const order = (a: PluginManifest, b: PluginManifest) => (a.behavior?.order ?? 0) - (b.behavior?.order ?? 0) || a.id.localeCompare(b.id)

/** Headless plugins have a lifetime independent of their views. No work at registration. */
export function createPluginBehaviorHost(
  manifests: readonly PluginManifest[],
  loaders: Readonly<Record<string, () => Promise<PluginBehaviorModule>>>,
) {
  const contributors = manifests.filter(m => (m.behavior?.hooks.length ?? 0) > 0).sort(order)
  const hooked = (hook: PluginBehaviorHook) => contributors.filter(m => m.behavior!.hooks.includes(hook))
  for (const manifest of contributors) {
    if (!Object.hasOwn(loaders, manifest.id)) throw new Error(`Plugin ${manifest.id} has no behavior loader`)
  }
  const scopes = new Map<string, ReturnType<typeof createPluginResourceScope>>()
  const registry = createLazyRegistry(loaders, (id, module) => {
    const manifest = contributors.find(m => m.id === id && m.apiVersion === PLUGIN_API_VERSION)
    const declaredMissing = manifest?.behavior?.hooks.some(hook => typeof module?.[hook] !== 'function')
    if (!manifest || module?.apiVersion !== PLUGIN_API_VERSION || module.pluginId !== id || declaredMissing
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
  const scopeFor = (id: string) => {
    let scope = scopes.get(id)
    if (!scope) {
      scope = createPluginResourceScope(id)
      scopes.set(id, scope)
    }
    return scope
  }
  let disposed = false
  return {
    isLoaded: (id: string) => registry.peek(id) !== undefined,
    /** Whether any enabled plugin observes settled turns: the host skips its work otherwise. */
    observesSettledTurns: () => hooked('afterTurn').some(m => isPluginEnabled(m.id)),
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
      for (const manifest of hooked('beforeTurn')) {
        if (!isPluginEnabled(manifest.id)) continue
        const signal = AbortSignal.any([context.signal, scopeFor(manifest.id).signal])
        const result = await abortable(signal, async () => {
          signal.throwIfAborted()
          const module = await registry.get(manifest.id)
          signal.throwIfAborted()
          return module.beforeTurn!({ target, signal, body: structuredClone(body) })
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
    /** Run beforeSteer hooks in order; a block refuses delivery with its reason. */
    async beforeSteer(context: { target: PluginTurnTarget; signal: AbortSignal; message: string }): Promise<string> {
      if (disposed) return context.message
      let message = context.message
      const target = Object.freeze({ ...context.target })
      for (const manifest of hooked('beforeSteer')) {
        if (!isPluginEnabled(manifest.id)) continue
        const signal = AbortSignal.any([context.signal, scopeFor(manifest.id).signal])
        const result = await abortable(signal, async () => (await registry.get(manifest.id)).beforeSteer!({ target, signal, message }))
        if (!result) continue
        if (result.action === 'block' && typeof result.reason === 'string' && result.reason.trim()) throw new PluginTurnBlockedError(manifest.id, result.reason)
        if (result.action !== 'patch' || typeof result.message !== 'string' || !result.message.trim()) throw new Error(`Plugin ${manifest.id} returned an invalid beforeSteer result`)
        message = result.message
      }
      return message
    },
    /** Whether any enabled plugin answers approvals: bridges skip the call otherwise. */
    presentsToolCards: () => hooked('toolCard').some(m => isPluginEnabled(m.id)),
    /** The first plugin presentation of a tool call, or null for the built-in card. Failures and slow hooks count as none. */
    async toolCard(context: PluginToolCardContext): Promise<{ pluginId: string; title?: string; lines: string[]; tone: 'info' | 'success' | 'warning' | 'error' } | null> {
      if (disposed) return null
      for (const manifest of hooked('toolCard')) {
        if (!isPluginEnabled(manifest.id)) continue
        const signal = AbortSignal.any([scopeFor(manifest.id).signal, AbortSignal.timeout(500)])
        try {
          const result = await abortable(signal, async () => (await registry.get(manifest.id)).toolCard!(context))
          if (!result) continue
          const text = typeof result.text === 'string' ? result.text : Array.isArray(result.lines) ? result.lines.filter(line => typeof line === 'string').join('\n') : ''
          const lines = text ? text.split('\n').map(line => line.slice(0, 400)).slice(0, 40) : []
          const title = typeof result.title === 'string' && result.title.trim() ? result.title.trim().slice(0, 120) : undefined
          if (!title && !lines.length) continue
          const tone = result.tone === 'success' || result.tone === 'warning' || result.tone === 'error' ? result.tone : 'info'
          return { pluginId: manifest.id, ...(title ? { title } : {}), lines, tone }
        } catch (error) {
          if (!(error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) console.error(`Plugin ${manifest.id} toolCard failed:`, error)
        }
      }
      return null
    },
    observesSteering: () => hooked('beforeSteer').some(m => isPluginEnabled(m.id)),
    decidesPermissions: () => hooked('permission').some(m => isPluginEnabled(m.id)),
    /**
     * The first plugin decision on an approval, or null to ask the person. A
     * failing or slow hook counts as undecided — never as allow.
     */
    async permission(context: { target: PluginTurnTarget; request: PluginPermissionRequest; signal?: AbortSignal }): Promise<{ pluginId: string; decision: 'allow' | 'deny'; reason?: string } | null> {
      if (disposed) return null
      const target = Object.freeze({ ...context.target })
      const request = Object.freeze(structuredClone(context.request))
      for (const manifest of hooked('permission')) {
        if (!isPluginEnabled(manifest.id)) continue
        const timeout = AbortSignal.timeout(PLUGIN_PERMISSION_TIMEOUT_MS)
        const signal = AbortSignal.any([scopeFor(manifest.id).signal, timeout, ...(context.signal ? [context.signal] : [])])
        try {
          const result = await abortable(signal, async () => (await registry.get(manifest.id)).permission!({ target, signal, request }))
          if (result && (result.decision === 'allow' || result.decision === 'deny')) {
            return { pluginId: manifest.id, decision: result.decision, ...(typeof result.reason === 'string' ? { reason: result.reason.slice(0, 500) } : {}) }
          }
        } catch (error) {
          if (!(error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) console.error(`Plugin ${manifest.id} permission hook failed:`, error)
        }
      }
      return null
    },
    /**
     * Run every enabled afterTurn hook in order. One hook's failure is logged
     * and the next still runs; the first valid follow-up is returned with the
     * plugin that asked for it.
     */
    async afterTurn(context: Omit<PluginAfterTurnContext, 'signal'>): Promise<{ pluginId: string; message: string } | null> {
      if (disposed) return null
      const target = Object.freeze({ ...context.target })
      let followUp: { pluginId: string; message: string } | null = null
      for (const manifest of hooked('afterTurn')) {
        if (!isPluginEnabled(manifest.id)) continue
        const signal = scopeFor(manifest.id).signal
        let result: PluginAfterTurnResult
        try {
          result = await abortable(signal, async () => {
            const module = await registry.get(manifest.id)
            signal.throwIfAborted()
            return module.afterTurn!({ target, signal, readMessages: context.readMessages, followUps: context.followUps })
          })
        } catch (error) {
          if (!(error instanceof Error && error.name === 'AbortError')) console.error(`Plugin ${manifest.id} afterTurn failed:`, error)
          continue
        }
        if (!result || followUp) continue
        if (result.action === 'follow-up' && typeof result.message === 'string' && result.message.trim()) {
          followUp = { pluginId: manifest.id, message: result.message }
        } else {
          console.error(`Plugin ${manifest.id} returned an invalid afterTurn result`)
        }
      }
      return followUp
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
