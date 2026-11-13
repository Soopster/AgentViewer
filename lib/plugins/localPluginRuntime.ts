// Loading and running local plugins' server modules — node-only.
//
// A server module may export (as named exports, or on a `default` object):
//   beforeTurn(context)  — see PluginBeforeTurnContext; return a patch or a block
//   afterTurn(context)   — see PluginAfterTurnContext; return a follow-up or nothing
//   commands: { [id]: (context) => effects }
// A command context has the captured target, a signal, `readMessages(limit)`
// for a session target, and `sendTurn(message)` to send a turn to that session
// through the ordinary send path. It returns effects as data
// (`{ notice, insertText, replaceText }`), which the renderer applies.
import { pathToFileURL } from 'node:url'
import { localPluginDiscovery, type LocalPlugin } from './localPlugins'
import { decodeLocalCommandEffects, decodeLocalWidgetContent, type LocalCommandEffects, type LocalWidgetContent } from './localManifest'
import { isPluginEnabled } from './enablement'
import { PLUGIN_API_VERSION } from './types'
import type { PluginBehaviorModule } from './behavior'
import type { PluginCommandTarget } from './commands'
import type { SessionMessage } from '../types'

type LocalServerModule = {
  beforeTurn?: PluginBehaviorModule['beforeTurn']
  afterTurn?: PluginBehaviorModule['afterTurn']
  beforeSteer?: PluginBehaviorModule['beforeSteer']
  permission?: PluginBehaviorModule['permission']
  toolCard?: PluginBehaviorModule['toolCard']
  deactivate?: () => void
  commands?: Record<string, (context: LocalCommandContext) => unknown>
  widgets?: Record<string, (context: { signal: AbortSignal }) => unknown>
}

export type LocalCommandContext = {
  readonly target: PluginCommandTarget
  readonly signal: AbortSignal
  readonly readMessages: (limit?: number) => Promise<SessionMessage[]>
  readonly sendTurn: (message: string) => Promise<void>
}

// Bypass the bundler: a mod's path is only known at runtime, and Next/Turbopack
// would otherwise try to resolve `import(variable)` at build time (the same
// indirection the SQLite index uses for node:sqlite).
const importAtRuntime = (0, eval)('(specifier) => import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>

const loaded = new Map<string, Promise<LocalServerModule>>()

function loadServerModule(plugin: LocalPlugin): Promise<LocalServerModule> {
  let pending = loaded.get(plugin.manifest.id)
  if (!pending) {
    pending = importAtRuntime(pathToFileURL(plugin.entry!).href).then((exported) => {
      const base = (exported.default && typeof exported.default === 'object' ? exported.default : exported) as LocalServerModule & { pluginId?: unknown }
      if (base.pluginId !== undefined && base.pluginId !== plugin.manifest.id) throw new Error(`Local plugin ${plugin.manifest.id} exports pluginId ${String(base.pluginId)}`)
      return base
    })
    pending.catch(() => loaded.delete(plugin.manifest.id))
    loaded.set(plugin.manifest.id, pending)
  }
  return pending
}

/** A discovered, enabled mod's server module, loaded once (the `mod` provider reads its `provider` export). */
export async function loadLocalPluginModule(pluginId: string): Promise<Record<string, unknown>> {
  const plugin = localPluginDiscovery().plugins.find(entry => entry.manifest.id === pluginId)
  if (!plugin) throw new Error(`No local plugin "${pluginId}"`)
  return await loadServerModule(plugin) as Record<string, unknown>
}

/** Behavior loaders for the server's behavior host, keyed by plugin id. */
export function localBehaviorLoaders(): Record<string, () => Promise<PluginBehaviorModule>> {
  return Object.fromEntries(localPluginDiscovery().plugins.filter(plugin => plugin.manifest.behavior).map(plugin => [plugin.manifest.id, async () => {
    const module = await loadServerModule(plugin)
    return {
      apiVersion: PLUGIN_API_VERSION,
      pluginId: plugin.manifest.id,
      ...(module.beforeTurn ? { beforeTurn: module.beforeTurn } : {}),
      ...(module.afterTurn ? { afterTurn: module.afterTurn } : {}),
      ...(module.beforeSteer ? { beforeSteer: module.beforeSteer } : {}),
      ...(module.permission ? { permission: module.permission } : {}),
      ...(module.toolCard ? { toolCard: module.toolCard } : {}),
      ...(module.deactivate ? { deactivate: module.deactivate } : {}),
    } satisfies PluginBehaviorModule
  }]))
}

/** Evict a module so the next use re-imports it (a plugin turned off and on again keeps Node's module cache, by design). */
export function forgetLocalPluginModule(id: string): void { loaded.delete(id) }

export async function runLocalPluginCommand(request: { pluginId: string; commandId: string; target: PluginCommandTarget }, signal: AbortSignal): Promise<LocalCommandEffects> {
  const plugin = localPluginDiscovery().plugins.find(entry => entry.manifest.id === request.pluginId)
  if (!plugin) throw new Error(`No local plugin "${request.pluginId}"`)
  if (!isPluginEnabled(plugin.manifest.id)) throw new Error(`${plugin.manifest.title} is turned off`)
  const command = plugin.manifest.commands.find(entry => entry.handler === request.commandId)
  if (!command) throw new Error(`${plugin.manifest.title} has no command "${request.commandId}"`)
  const session = request.target.session
  if (command.requires === 'session' && !session) throw new Error(`${command.label} needs a session`)
  if (command.requires === 'repository' && !request.target.cwd) throw new Error(`${command.label} needs a repository`)
  const module = await loadServerModule(plugin)
  const handler = module.commands?.[request.commandId]
  if (typeof handler !== 'function') throw new Error(`${plugin.manifest.title}'s server module has no commands.${request.commandId}`)
  signal.throwIfAborted()
  const target = Object.freeze({ session: session ? Object.freeze({ ...session }) : null, cwd: request.target.cwd })
  const scoped = async <T,>(run: () => Promise<T>): Promise<T> => {
    if (!session?.providerInstanceId || !session.provider) return run()
    const { withProviderInstance } = await import('../providerInstances')
    return withProviderInstance(session.providerInstanceId, session.provider, run)
  }
  const context: LocalCommandContext = {
    target,
    signal,
    readMessages: async (limit = 200) => {
      if (!session) return []
      return scoped(async () => {
        const { listViewSessionMessages } = await import('../sessionReads')
        return listViewSessionMessages(session.sessionId, { limit: Math.max(1, Math.min(limit, 2_000)), offset: 0, tail: true }, session.provider)
      })
    },
    sendTurn: async (message: string) => {
      if (!session) throw new Error('sendTurn needs a session target')
      signal.throwIfAborted()
      await scoped(async () => {
        const { streamViewSessionTurn } = await import('../sessionBackend')
        const response = await streamViewSessionTurn({ sessionId: session.sessionId, provider: session.provider, signal: new AbortController().signal, body: { message, pluginFollowUp: plugin.manifest.id } })
        if (!response.ok) throw new Error((await response.text().catch(() => '')) || `Turn rejected (${response.status})`)
        const reader = response.body?.getReader()
        if (reader) void (async () => { while (!(await reader.read()).done) { /* drain so the turn runs */ } })().catch(() => {})
      })
    },
  }
  return decodeLocalCommandEffects(await handler(context))
}

const WIDGET_TIMEOUT_MS = 2_000

/**
 * Every enabled mod's widget content. A widget function that throws, returns
 * nothing or takes longer than two seconds is simply not shown this round.
 */
export async function readLocalPluginWidgets(signal: AbortSignal = new AbortController().signal): Promise<LocalWidgetContent[]> {
  const plugins = localPluginDiscovery().plugins.filter(plugin => plugin.manifest.localWidgets?.length && isPluginEnabled(plugin.manifest.id))
  const results = await Promise.all(plugins.flatMap(plugin => plugin.manifest.localWidgets!.map(async (widget) => {
    try {
      const module = await loadServerModule(plugin)
      const read = module.widgets?.[widget.id]
      if (typeof read !== 'function') return null
      const widgetSignal = AbortSignal.any([signal, AbortSignal.timeout(WIDGET_TIMEOUT_MS)])
      const value = await Promise.race([
        Promise.resolve(read({ signal: widgetSignal })),
        new Promise((_, reject) => widgetSignal.addEventListener('abort', () => reject(widgetSignal.reason), { once: true })),
      ])
      return decodeLocalWidgetContent(plugin.manifest.id, widget.id, plugin.manifest.title, value)
    } catch (error) {
      if (!(error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) console.error(`Local plugin ${plugin.manifest.id} widget ${widget.id} failed:`, error)
      return null
    }
  })))
  return results.filter((entry): entry is LocalWidgetContent => entry !== null)
}
