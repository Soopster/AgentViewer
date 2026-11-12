import { createLazyRegistry } from '../extensions/lazyRegistry'
import { createPluginResourceScope } from './lifecycle'
import { isPluginEnabled, subscribePluginEnablement } from './enablement'
import { PLUGIN_API_VERSION, type PluginManifest, type PluginRenderer } from './types'
import type { PluginCommandModule, PluginCommandServices, PluginCommandTarget } from './commands'

export type PluginCommandLoaders = Readonly<Record<string, () => Promise<PluginCommandModule>>>

export function createPluginCommandHost(renderer: PluginRenderer, manifests: readonly PluginManifest[], loaders: PluginCommandLoaders) {
  const contributors = manifests.filter(m => m.renderers.includes(renderer) && m.commands.some(c => c.handler && c.renderers.includes(renderer)))
  for (const manifest of contributors) if (!Object.hasOwn(loaders, manifest.id)) throw new Error(`Plugin ${manifest.id} has no ${renderer} command loader`)
  const registry = createLazyRegistry(loaders, (id, module) => {
    const manifest = contributors.find(m => m.id === id)
    if (!manifest || manifest.apiVersion !== PLUGIN_API_VERSION || module?.apiVersion !== PLUGIN_API_VERSION || module.pluginId !== id) throw new Error(`Plugin ${id} command API or identity mismatch`)
    for (const command of manifest.commands) {
      if (command.handler && command.renderers.includes(renderer) && (!Object.hasOwn(module.handlers ?? {}, command.handler) || typeof module.handlers[command.handler] !== 'function')) throw new Error(`Plugin ${id} has no command handler ${command.handler}`)
    }
  })
  const scopes = new Map<string, Set<ReturnType<typeof createPluginResourceScope>>>()
  let disposed = false
  const cancelAll = () => { for (const set of scopes.values()) for (const scope of [...set]) scope.dispose() }
  const unsubscribe = subscribePluginEnablement(() => {
    for (const manifest of contributors) if (!isPluginEnabled(manifest.id)) {
      registry.evict(manifest.id)
      for (const scope of scopes.get(manifest.id) ?? []) scope.dispose()
    }
  })
  return {
    cancelAll,
    isLoaded: (id: string) => registry.peek(id) !== undefined,
    dispose() { if (disposed) return; disposed = true; unsubscribe(); cancelAll(); for (const manifest of contributors) registry.evict(manifest.id) },
    async run(commandId: string, context: {
      target: PluginCommandTarget
      services: PluginCommandServices
      signal?: AbortSignal
      /** Synchronous ownership check also covers the render-to-effect cancellation gap. */
      isCurrent?: () => boolean
    }): Promise<void> {
      const manifest = contributors.find(m => m.commands.some(c => c.id === commandId && c.handler && c.renderers.includes(renderer)))
      const command = manifest?.commands.find(c => c.id === commandId)
      if (!manifest || !command?.handler) throw new Error(`Unknown ${renderer} plugin action: ${commandId}`)
      if (disposed || !isPluginEnabled(manifest.id)) throw abortError('Plugin command is disabled or its host was disposed')
      if (command.requires === 'session' && !context.target.session) throw new Error(`${command.label} needs a session`)
      if (command.requires === 'repository' && !context.target.cwd) throw new Error(`${command.label} needs a repository`)
      if (command.providers && (!context.target.session || !command.providers.includes(context.target.session.provider ?? 'claude'))) throw new Error(`${command.label} is unavailable for this provider`)
      const missing = command.services.filter(id => !context.services[id])
      if (missing.length) throw new Error(`${command.label} needs command services: ${missing.join(', ')}`)
      const source = context.target.session
      const target = Object.freeze({ session: source ? Object.freeze({ sessionId: source.sessionId, provider: source.provider, providerInstanceId: source.providerInstanceId }) : null, cwd: context.target.cwd })
      const scope = createPluginResourceScope(manifest.id)
      const signal = context.signal ? AbortSignal.any([scope.signal, context.signal]) : scope.signal
      let set = scopes.get(manifest.id)
      if (!set) scopes.set(manifest.id, set = new Set())
      set.add(scope)
      const check = () => {
        signal.throwIfAborted()
        if (context.isCurrent && !context.isCurrent()) throw abortError('Plugin command target changed')
      }
      const active = () => !signal.aborted && (!context.isCurrent || context.isCurrent())
      const services: PluginCommandServices = {}
      if (command.services.includes('bridge-routing') && context.services['bridge-routing']) {
        const routing = context.services['bridge-routing']
        Object.assign(services, { 'bridge-routing': {
          ...(routing.channel ? { channel: { toggle: () => { if (active()) routing.channel!.toggle() } } } : {}),
          ...(routing.ide ? { ide: { toggle: () => { if (active()) routing.ide!.toggle() } } } : {}),
        } })
      }
      if (command.services.includes('composer-accessories') && context.services['composer-accessories']) {
        const accessories = context.services['composer-accessories']
        Object.assign(services, { 'composer-accessories': { open: (id: string) => { if (active()) accessories.open(id) } } })
      }
      // Capabilities are copied and bound once, never looked up from the later selection.
      if (command.services.includes('composer') && context.services.composer) {
        const composer = context.services.composer
        Object.assign(services, { composer: {
          replaceText: (text: string) => { if (active()) composer.replaceText(text) },
          insertText: (text: string) => { if (active()) composer.insertText(text) },
        } })
      }
      if (command.services.includes('transcript') && context.services.transcript) {
        const transcript = context.services.transcript
        Object.assign(services, { transcript: { read: async (readSignal: AbortSignal) => {
          check()
          const combined = AbortSignal.any([signal, readSignal])
          combined.throwIfAborted()
          const messages = await transcript.read(combined)
          check(); combined.throwIfAborted()
          return structuredClone(messages)
        } } })
      }
      if (command.services.includes('notices') && context.services.notices) {
        const notices = context.services.notices
        Object.assign(services, { notices: { show: (kind: 'info' | 'error', text: string) => { if (active()) notices.show(kind, text) } } })
      }
      try {
        await abortable(signal, async () => {
          check()
          const module = await registry.get(manifest.id)
          check()
          await module.handlers[command.handler!]!({ target, signal, services, defer: scope.defer })
          check()
        })
      } catch (error) {
        check()
        throw error
      } finally {
        scope.dispose()
        set.delete(scope)
        if (!set.size) scopes.delete(manifest.id)
      }
    },
  }
}

function abortError(message: string): Error { const error = new Error(message); error.name = 'AbortError'; return error }
function abortable<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    Promise.resolve().then(run).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}
