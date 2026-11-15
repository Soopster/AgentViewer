import { snapshotLocalModEntry } from './modRuntimeSnapshot'
import { clearPluginToolCardCache } from './toolCards'
import { readModConfig, readModConfigValues, writeModConfig } from './modConfigStore'
import type { ModConfigValue } from './modConfig'
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
import { freezeSnapshot, type ModAppSnapshot } from './modApp'
import { recordModDiagnostic } from './modDiagnostics'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { localPluginDiscovery, subscribeLocalPluginReload, type LocalPlugin } from './localPlugins'
import { decodeLocalCommandEffects, decodeLocalWidgetContent, type LocalCommandEffects, type LocalWidgetContent } from './localManifest'
import { isPluginEnabled } from './enablement'
import { PLUGIN_API_VERSION } from './types'
import type { PluginBehaviorModule } from './behavior'
import type { PluginCommandTarget } from './commands'
import type { SessionMessage } from '../types'

export type LocalModContext = { readonly app?: ModAppSnapshot; readonly config: Readonly<Record<string, ModConfigValue>> }
type AppContext = LocalModContext
function appContext(plugin: LocalPlugin, app?: ModAppSnapshot): AppContext {
  return { config: readModConfig(plugin.manifest.id, plugin.manifest.config), ...(app && plugin.manifest.appServices?.length ? { app: freezeSnapshot(app) } : {}) }
}
async function diagnosed<T>(pluginId: string, contribution: string, run: () => T | Promise<T>): Promise<T> {
  try { return await run() } catch (error) { recordModDiagnostic(pluginId, contribution, error); throw error }
}
type LocalServerModule = {
  beforeTurn?: (context: Parameters<NonNullable<PluginBehaviorModule['beforeTurn']>>[0] & LocalModContext) => ReturnType<NonNullable<PluginBehaviorModule['beforeTurn']>>
  afterTurn?: (context: Parameters<NonNullable<PluginBehaviorModule['afterTurn']>>[0] & LocalModContext) => ReturnType<NonNullable<PluginBehaviorModule['afterTurn']>>
  beforeSteer?: (context: Parameters<NonNullable<PluginBehaviorModule['beforeSteer']>>[0] & LocalModContext) => ReturnType<NonNullable<PluginBehaviorModule['beforeSteer']>>
  permission?: (context: Parameters<NonNullable<PluginBehaviorModule['permission']>>[0] & LocalModContext) => ReturnType<NonNullable<PluginBehaviorModule['permission']>>
  runtimeEvent?: (context: Parameters<NonNullable<PluginBehaviorModule['runtimeEvent']>>[0] & LocalModContext) => ReturnType<NonNullable<PluginBehaviorModule['runtimeEvent']>>
  toolCard?: (context: Parameters<NonNullable<PluginBehaviorModule['toolCard']>>[0] & LocalModContext) => ReturnType<NonNullable<PluginBehaviorModule['toolCard']>>
  deactivate?: () => void
  commands?: Record<string, (context: LocalCommandContext) => unknown>
  widgets?: Record<string, (context: AppContext & { signal: AbortSignal }) => unknown>
  views?: Record<string, (context: AppContext & { signal: AbortSignal }) => unknown>
  actions?: Record<string, (context: AppContext & { signal: AbortSignal; view: string; item?: string }) => unknown>
}

export type LocalCommandContext = AppContext & {
  readonly target: PluginCommandTarget
  readonly input?: import('./commands').PluginCommandInput
  readonly signal: AbortSignal
  readonly readMessages: (limit?: number) => Promise<SessionMessage[]>
  readonly sendTurn: (message: string) => Promise<void>
}

// Bypass the bundler: a mod's path is only known at runtime, and Next/Turbopack
// would otherwise try to resolve `import(variable)` at build time (the same
// indirection the SQLite index uses for node:sqlite).
const importAtRuntime = (0, eval)('(specifier) => import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>

const loaded = new Map<string, Promise<LocalServerModule>>()
let moduleLife = new AbortController()
const deactivated = new WeakSet<LocalServerModule>()
function deactivateModule(module: LocalServerModule): void {
  if (deactivated.has(module)) return
  deactivated.add(module)
  try { module.deactivate?.() } catch (error) { console.error('Mod deactivation failed:', error) }
}
subscribeLocalPluginReload(() => {
  clearPluginToolCardCache()
  moduleLife.abort(new DOMException('Mods reloaded', 'AbortError'))
  moduleLife = new AbortController()
  for (const pending of loaded.values()) void pending.then(deactivateModule).catch(() => {})
  loaded.clear()
})

function loadServerModule(plugin: LocalPlugin): Promise<LocalServerModule> {
  let pending = loaded.get(plugin.manifest.id)
  if (!pending) {
    pending = importAtRuntime(pathToFileURL(snapshotLocalModEntry(plugin.dir, plugin.entry!, localPluginDiscovery().revision ?? 'initial')).href).then((exported) => {
      const base = (exported.default && typeof exported.default === 'object' ? exported.default : exported) as LocalServerModule & { pluginId?: unknown }
      if (base.pluginId !== undefined && base.pluginId !== plugin.manifest.id) throw new Error(`Local plugin ${plugin.manifest.id} exports pluginId ${String(base.pluginId)}`)
      for (const hook of plugin.manifest.behavior?.hooks ?? []) if (typeof base[hook] !== 'function') throw new Error(`Missing ${hook} export`)
      return base
    })
    pending.catch(error => { loaded.delete(plugin.manifest.id); recordModDiagnostic(plugin.manifest.id, 'load', error) })
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
    deactivated.delete(module)
    return {
      apiVersion: PLUGIN_API_VERSION,
      pluginId: plugin.manifest.id,
      ...(module.beforeTurn ? { beforeTurn: context => diagnosed(plugin.manifest.id, 'beforeTurn', () => module.beforeTurn!({ ...context, ...appContext(plugin) })) } : {}),
      ...(module.afterTurn ? { afterTurn: context => diagnosed(plugin.manifest.id, 'afterTurn', () => module.afterTurn!({ ...context, ...appContext(plugin) })) } : {}),
      ...(module.beforeSteer ? { beforeSteer: context => diagnosed(plugin.manifest.id, 'beforeSteer', () => module.beforeSteer!({ ...context, ...appContext(plugin) })) } : {}),
      ...(module.permission ? { permission: context => diagnosed(plugin.manifest.id, 'permission', () => module.permission!({ ...context, ...appContext(plugin) })) } : {}),
      ...(module.toolCard ? { toolCard: context => diagnosed(plugin.manifest.id, 'toolCard', () => module.toolCard!({ ...context, ...appContext(plugin) })) } : {}),
      ...(module.runtimeEvent ? { runtimeEvent: context => diagnosed(plugin.manifest.id, 'runtimeEvent', () => module.runtimeEvent!({ ...context, ...appContext(plugin) })) } : {}),
      ...(module.deactivate ? { deactivate: () => deactivateModule(module) } : {}),
    } satisfies PluginBehaviorModule
  }]))
}

/** Evict a module so the next use re-imports it (a plugin turned off and on again keeps Node's module cache, by design). */
export function forgetLocalPluginModule(id: string): void { loaded.delete(id) }

export async function runLocalPluginCommand(request: { pluginId: string; commandId: string; target: PluginCommandTarget; input?: import('./commands').PluginCommandInput; app?: ModAppSnapshot }, signal: AbortSignal): Promise<LocalCommandEffects> {
  const plugin = localPluginDiscovery().plugins.find(entry => entry.manifest.id === request.pluginId)
  signal = AbortSignal.any([signal, moduleLife.signal])
  if (!plugin) throw new Error(`No local plugin "${request.pluginId}"`)
  if (!isPluginEnabled(plugin.manifest.id)) throw new Error(`${plugin.manifest.title} is turned off`)
  const command = plugin.manifest.commands.find(entry => entry.handler === request.commandId)
  if (!command) throw new Error(`${plugin.manifest.title} has no command "${request.commandId}"`)
  const session = request.target.session
  if (command.requires === 'session' && !session) throw new Error(`${command.label} needs a session`)
  if (command.requires === 'repository' && !request.target.cwd) throw new Error(`${command.label} needs a repository`)
  const module = await loadServerModule(plugin)
  const handler = module.commands?.[request.commandId]
  if (typeof handler !== 'function') { const error = new Error(`${plugin.manifest.title}'s server module has no commands.${request.commandId}`); recordModDiagnostic(plugin.manifest.id, `command:${request.commandId}`, error); throw error }
  signal.throwIfAborted()
  const target = Object.freeze({ session: session ? Object.freeze({ ...session }) : null, cwd: request.target.cwd })
  const scoped = async <T,>(run: () => Promise<T>): Promise<T> => {
    if (!session?.providerInstanceId || !session.provider) return run()
    const { withProviderInstance } = await import('../providerInstances')
    return withProviderInstance(session.providerInstanceId, session.provider, run)
  }
  const context: LocalCommandContext = { ...appContext(plugin, request.app),
    target, input: request.input,
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
  return diagnosed(plugin.manifest.id, `command:${request.commandId}`, async () => { const value = await handler(context); signal.throwIfAborted(); return decodeLocalCommandEffects(value) })
}

const WIDGET_TIMEOUT_MS = 2_000

/**
 * Every enabled mod's widget content. A widget function that throws, returns
 * nothing or takes longer than two seconds is simply not shown this round.
 */
export async function readLocalPluginWidgets(signal: AbortSignal = new AbortController().signal, app?: ModAppSnapshot): Promise<LocalWidgetContent[]> {
  const plugins = localPluginDiscovery().plugins.filter(plugin => plugin.manifest.localWidgets?.length && isPluginEnabled(plugin.manifest.id))
  const results = await Promise.all(plugins.flatMap(plugin => plugin.manifest.localWidgets!.map(async (widget) => {
    try {
      const module = await loadServerModule(plugin)
      const read = module.widgets?.[widget.id]
      if (typeof read !== 'function') throw new Error(`Missing widgets.${widget.id} export`)
      const widgetSignal = AbortSignal.any([signal, AbortSignal.timeout(WIDGET_TIMEOUT_MS)])
      const value = await Promise.race([
        Promise.resolve(read({ ...appContext(plugin, app), signal: widgetSignal })),
        new Promise((_, reject) => widgetSignal.addEventListener('abort', () => reject(widgetSignal.reason), { once: true })),
      ])
      return decodeLocalWidgetContent(plugin.manifest.id, widget.id, plugin.manifest.title, value)
    } catch (error) {
      recordModDiagnostic(plugin.manifest.id, `widget:${widget.id}`, error)
      if (!(error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) console.error(`Local plugin ${plugin.manifest.id} widget ${widget.id} failed:`, error)
      return null
    }
  })))
  return results.filter((entry): entry is LocalWidgetContent => entry !== null)
}

/** Every enabled mod's declared views. */
export function listLocalPluginViews(): Array<{ pluginId: string; viewId: string; title: string; component?: boolean }> {
  return localPluginDiscovery().plugins.filter(plugin => isPluginEnabled(plugin.manifest.id))
    .flatMap(plugin => (plugin.manifest.localViews ?? []).map(view => ({ pluginId: plugin.manifest.id, viewId: view.id, title: view.title, ...(view.component ? { component: true } : {}) })))
}

/** The file holding a mod's components for a renderer: `<renderer>.mjs` or `<renderer>.js`. */
export function localPluginComponentFile(pluginId: string, renderer: 'web' | 'tui'): string | null {
  const plugin = localPluginDiscovery().plugins.find(entry => entry.manifest.id === pluginId)
  if (!plugin || !isPluginEnabled(pluginId)) return null
  for (const name of [`${renderer}.mjs`, `${renderer}.js`]) {
    const file = path.join(plugin.dir, name)
    if (existsSync(file)) return file
  }
  return null
}

function enabledViewPlugin(pluginId: string, viewId: string) {
  const plugin = localPluginDiscovery().plugins.find(entry => entry.manifest.id === pluginId)
  if (!plugin || !isPluginEnabled(pluginId) || !plugin.manifest.localViews?.some(view => view.id === viewId)) throw new Error(`No view "${viewId}" in an enabled mod "${pluginId}"`)
  return plugin
}

/** One mod view, as data (decoded by lib/plugins/modViews.ts). */
export async function renderLocalPluginView(pluginId: string, viewId: string, signal: AbortSignal = new AbortController().signal, app?: ModAppSnapshot): Promise<unknown> {
  const plugin = enabledViewPlugin(pluginId, viewId)
  signal = AbortSignal.any([signal, moduleLife.signal])
  if (viewId === 'mod-config' && plugin.manifest.config) {
    const values = readModConfigValues(pluginId)
    return { title: `${plugin.manifest.title} settings`, blocks: Object.entries(plugin.manifest.config).flatMap(([key, field]) => {
      if (field.secretEnv) return [{ type: 'text', text: `${field.title}: set environment variable ${field.secretEnv}${process.env[field.secretEnv] ? ' (available)' : ' (not set)'}` }]
      const value = values[key] ?? field.default
      const label = `${field.title}${field.required ? ' *' : ''}`
      const action = `config:${key}`
      const options = field.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : field.enum?.map(value => ({ value, label: value }))
      return [{ type: options ? 'select' : 'input', id: key, label, action, value: value === undefined ? '' : String(value), ...(options ? { options } : {}) }, ...(field.description ? [{ type: 'text', text: field.description }] : [])]
    }) }
  }
  const module = await loadServerModule(plugin)
  const render = module.views?.[viewId]
  if (typeof render !== 'function') { const error = new Error(`${plugin.manifest.title}'s server module has no views.${viewId}`); recordModDiagnostic(pluginId, `view:${viewId}`, error); throw error }
  signal.throwIfAborted()
  return diagnosed(pluginId, `view:${viewId}`, () => render({ ...appContext(plugin, app), signal }))
}

/** Run a view's action where the mod lives; answers with effects as data. */
export async function runLocalPluginViewAction(pluginId: string, viewId: string, action: string, item: string | undefined, signal: AbortSignal = new AbortController().signal, app?: ModAppSnapshot): Promise<LocalCommandEffects> {
  const plugin = enabledViewPlugin(pluginId, viewId)
  signal = AbortSignal.any([signal, moduleLife.signal])
  if (viewId === 'mod-config' && plugin.manifest.config) {
    signal.throwIfAborted()
    const key = action.startsWith('config:') ? action.slice(7) : ''
    const field = plugin.manifest.config[key]
    if (!field || field.secretEnv || item === undefined) throw new Error('Unknown configuration action')
    if (field.type === 'number' && !item.trim()) throw new Error(`Invalid config value for ${key}`)
    if (field.type === 'boolean' && item !== 'true' && item !== 'false') throw new Error(`Invalid config value for ${key}`)
    writeModConfig(pluginId, plugin.manifest.config, { [key]: field.type === 'number' ? Number(item) : field.type === 'boolean' ? item === 'true' : item })
    return { notice: { kind: 'info', text: `${field.title} saved` } }
  }
  const module = await loadServerModule(plugin)
  const run = module.actions?.[action]
  if (typeof run !== 'function') { const error = new Error(`${plugin.manifest.title} has no action "${action}"`); recordModDiagnostic(pluginId, `action:${action}`, error); throw error }
  return diagnosed(pluginId, `action:${action}`, async () => { const value = await run({ ...appContext(plugin, app), signal, view: viewId, ...(item !== undefined ? { item } : {}) }); signal.throwIfAborted(); return decodeLocalCommandEffects(value) })
}
