// Bun/Node author fixtures. No provider is loaded; imported mod code is trusted.
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolveModConfig, type ModConfigSchema } from './modConfig'
import { decodeLocalCommandEffects } from './localManifest'
import { decodeModView, type ModViewBlock } from './modViews'
import { EMPTY_MOD_APP, freezeSnapshot, type ModAppSnapshot } from './modApp'
import type { ModServerModule } from './modSdk'
import type { PluginCommandTarget } from './commands'
import type { SessionMessage } from '../types'

export async function loadModTestModule(file: string): Promise<ModServerModule> {
  const exported = await import(`${pathToFileURL(file).href}?mod-test=${randomUUID()}`)
  return exported.default ?? exported
}
export type ModHarnessOptions = {
  configSchema?: ModConfigSchema; config?: Record<string, unknown>; env?: Record<string, string | undefined>
  app?: ModAppSnapshot; target?: PluginCommandTarget; messages?: SessionMessage[]
}
export function createModHarness(module: ModServerModule, options: ModHarnessOptions = {}) {
  const controller = new AbortController()
  const config = resolveModConfig(options.configSchema, options.config, options.env)
  const app = freezeSnapshot(structuredClone(options.app ?? EMPTY_MOD_APP))
  const target: PluginCommandTarget = Object.freeze(structuredClone(options.target ?? { session: { provider: 'claude' as const, providerInstanceId: 'fixture-account', sessionId: 'fixture' }, cwd: '/fixture' }))
  if (target.session) Object.freeze(target.session)
  const sent: string[] = []
  let active = true
  const check = () => { controller.signal.throwIfAborted(); if (!active) throw new Error('Harness is disabled') }
  const context = { config, app, target, signal: controller.signal,
    readMessages: async (limit = 200) => { check(); return structuredClone((options.messages ?? []).slice(-limit)) },
    sendTurn: async (message: string) => { check(); sent.push(message) },
  }
  const perform = async <T,>(work: () => T | Promise<T>): Promise<T> => {
    check()
    // Reject pending work when disabled even if the mod ignores its signal.
    let cancel: (() => void) | undefined
    try {
      return await Promise.race([Promise.resolve().then(work), new Promise<never>((_, reject) => {
        cancel = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', cancel, { once: true })
      })]).then(value => { check(); return value })
    } finally { if (cancel) controller.signal.removeEventListener('abort', cancel) }
  }
  return {
    sent, signal: controller.signal,
    disable() { if (!active) return; active = false; controller.abort(); module.deactivate?.() },
    command(id: string, input?: import('./commands').PluginCommandInput) {
      return perform(async () => { const fn = module.commands?.[id]; if (!fn) throw new Error(`Missing command ${id}`); return decodeLocalCommandEffects(await fn({ ...context, input })) })
    },
    render(id: string) {
      return perform(async () => { const fn = module.views?.[id]; if (!fn) throw new Error(`Missing view ${id}`); return decodeModView(await fn(context), id) })
    },
    action(view: string, action: string, item?: string) {
      return perform(async () => { const fn = module.actions?.[action]; if (!fn) throw new Error(`Missing action ${action}`); return decodeLocalCommandEffects(await fn({ ...context, view, item })) })
    },
    async press(view: string, action: string, value?: string) {
      const content = await this.render(view)
      const block = content.blocks.find(block => 'action' in block && block.action === action)
      if (!block || !('action' in block)) throw new Error(`Action ${action} is not drawn in ${view}`)
      if (block.type === 'select' && !block.options.some(option => option.value === value)) throw new Error('Unknown selection')
      return this.action(view, action, block.type === 'item' ? block.id : value)
    },
    beforeTurn(body: Readonly<Record<string, unknown>>) {
      return perform(async () => {
        if (!target.session?.provider) throw new Error('Session target required')
        return module.beforeTurn?.({ ...context, target: { provider: target.session.provider, providerInstanceId: target.session.providerInstanceId, sessionId: target.session.sessionId }, body: structuredClone(body) })
      })
    },
  }
}
export type ModHarness = ReturnType<typeof createModHarness>
export type PortableModControl = Extract<ModViewBlock, { type: 'input' | 'select' | 'button' | 'item' }>
