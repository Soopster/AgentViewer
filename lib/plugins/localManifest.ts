import { validatePluginToolSpecs } from './pluginTools'
import { parseModConfigSchema, type ModConfigSchema } from './modConfig'
import { parseModPackageMetadata, type ModPackageMetadata } from './modPackageMetadata'
// Local plugins ("mods"): plugins the user installs in their own config
// directory, not bundled with the app. This module is the browser-safe half —
// what a local plugin may declare and how one of its commands reaches the
// renderer. Discovery and code loading are node-only (localPlugins.ts,
// localPluginRuntime.ts).
//
// A local plugin contributes behavior (beforeTurn/afterTurn) and commands. All
// of its code runs on the server side — in the TUI's own process, or the Web
// daemon's — and a command answers with *effects as data*: a notice, text for
// the composer, a follow-up turn. That keeps one mod working in both renderers
// with no build step, and keeps the renderer's capability checks in charge of
// what reaches the screen.
import { applyModAppEffects, decodeModAppEffect, modAppStore, type ModAppSnapshot, type ModAppEffect } from './modApp'
import { recordModDiagnostic } from './modDiagnostics'
import { isPluginEnabled } from './enablement'
import { PLUGIN_API_VERSION, type PluginCommandServiceId, type PluginCommandSpec, type PluginManifest, type PluginPlacement, type PluginWidgetSlot } from './types'
import type { PluginCommandModule, PluginCommandTarget } from './commands'

export const LOCAL_PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const LOCAL_COMMAND_SERVICES: readonly PluginCommandServiceId[] = ['notices', 'composer', 'transcript']
const CATEGORIES = ['Session', 'View', 'Transcript', 'Coordination'] as const

/** A validated local plugin manifest, as the catalog and both plugin managers list it. */
export type LocalWidgetSlot = Exclude<PluginWidgetSlot, 'top-bar'>
export const LOCAL_WIDGET_SLOTS: readonly LocalWidgetSlot[] = ['corner', 'top-center', 'viewport']
export type LocalViewSpec = { readonly id: string; readonly title: string; readonly component?: boolean; readonly placements?: readonly PluginPlacement[]; readonly defaultPlacement?: 'overlay' | 'panel'; readonly panelOrder?: number }

export type LocalPluginManifest = PluginManifest & ModPackageMetadata & {
  readonly source: 'local'
  readonly config?: ModConfigSchema
  readonly appServices?: readonly ('data' | 'navigation')[]
  /** A mod's widgets are content from its server module, drawn by the shell. */
  readonly localWidgets?: readonly { readonly id: string; readonly slot: LocalWidgetSlot; readonly refreshMs: number; readonly order?: number }[]
  /** A mod that is an agent backend: its sessions appear under the `mod` provider (lib/modProvider.ts). */
  readonly localProvider?: { readonly displayName: string }
  /** Interactive views the mod returns as data (lib/plugins/modViews.ts). */
  readonly localViews?: readonly LocalViewSpec[]
}

/** A mod view's surface id. A dot never appears in a plugin id, so it cannot name a built-in. */
export function localViewSurfaceId(pluginId: string, viewId: string): string { return `${pluginId}.${viewId}` }
/** The mod view a local surface draws, or null for any other surface. */
export function parseLocalViewSurfaceId(surfaceId: string): { pluginId: string; viewId: string } | null {
  const dot = surfaceId.indexOf('.')
  return dot > 0 ? { pluginId: surfaceId.slice(0, dot), viewId: surfaceId.slice(dot + 1) } : null
}

export const LOCAL_WIDGET_REFRESH_MS = 5_000
export const LOCAL_WIDGET_MIN_REFRESH_MS = 1_000

/** What a mod widget shows: a title and a few lines, in a tone the shell colours. */
export type LocalWidgetContent = {
  readonly pluginId: string
  readonly id: string
  readonly title: string
  readonly lines: readonly string[]
  readonly tone: 'info' | 'success' | 'warning' | 'error'
}

/** Decoded from untrusted module output or an HTTP body; null hides the widget. */
export function decodeLocalWidgetContent(pluginId: string, id: string, fallbackTitle: string, value: unknown): LocalWidgetContent | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const text = typeof raw.text === 'string' ? raw.text : Array.isArray(raw.lines) ? raw.lines.filter((line): line is string => typeof line === 'string').join('\n') : ''
  const lines = text.split('\n').map(line => line.slice(0, 200)).filter((line, index, all) => line || index < all.length - 1).slice(0, 8)
  if (!lines.length) return null
  const tone = raw.tone === 'success' || raw.tone === 'warning' || raw.tone === 'error' ? raw.tone : 'info'
  return { pluginId, id, title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 60) : fallbackTitle, lines, tone }
}

/** Reads every enabled mod widget's content where the mods run (in process, or the daemon). */
export type LocalWidgetReader = (signal: AbortSignal) => Promise<LocalWidgetContent[]>
let widgetReader: LocalWidgetReader | null = null
const widgetReaderListeners = new Set<() => void>()
export function setLocalWidgetReader(next: LocalWidgetReader): void {
  widgetReader = next
  for (const listener of widgetReaderListeners) listener()
}
export function subscribeLocalWidgetReader(listener: () => void): () => void { widgetReaderListeners.add(listener); return () => { widgetReaderListeners.delete(listener) } }
export function localWidgetReader(): LocalWidgetReader | null { return widgetReader }

export function isLocalManifest(manifest: PluginManifest): manifest is LocalPluginManifest {
  return (manifest as { source?: unknown }).source === 'local'
}

/** What a local command asks the renderer to do once it returns. */
export type LocalCommandEffects = {
  readonly notice?: { readonly kind: 'info' | 'error'; readonly text: string }
  readonly insertText?: string
  readonly replaceText?: string
  readonly appEffects?: readonly ModAppEffect[]
}

/**
 * Parse a plugin.json body. Returns the manifest, or the reasons it was refused;
 * a refused plugin is listed with its problems and never loaded.
 */
export function parseLocalPluginManifest(raw: unknown, reserved: ReadonlySet<string>): { manifest: LocalPluginManifest | null; problems: string[] } {
  const problems: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { manifest: null, problems: ['plugin.json is not an object'] }
  const value = raw as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id : ''
  if (!LOCAL_PLUGIN_ID.test(id)) problems.push('id must be lowercase letters, digits and dashes (at most 48)')
  else if (reserved.has(id)) problems.push(`id "${id}" is a bundled plugin's`)
  if (value.apiVersion !== undefined && value.apiVersion !== PLUGIN_API_VERSION) problems.push(`apiVersion ${String(value.apiVersion)} is not supported (this app runs ${PLUGIN_API_VERSION})`)
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 64) : id
  const description = typeof value.description === 'string' ? value.description.trim().slice(0, 240) : ''

  let packageMetadata: ModPackageMetadata = {}
  try { packageMetadata = parseModPackageMetadata(value) } catch (error) { problems.push(error instanceof Error ? error.message : String(error)) }
  let config: ModConfigSchema | undefined
  if (value.config !== undefined) { try { config = parseModConfigSchema(value.config) } catch (error) { problems.push(error instanceof Error ? error.message : String(error)) } }
  const appServices = Array.isArray(value.appServices) ? value.appServices : []
  if (value.appServices !== undefined && (!Array.isArray(value.appServices) || appServices.some(service => service !== 'data' && service !== 'navigation'))) problems.push('appServices must list data and/or navigation')
  const toolSpecs = value.tools === undefined ? { specs: [], problems: [] as string[] } : validatePluginToolSpecs(value.tools)
  problems.push(...toolSpecs.problems)
  let behavior: PluginManifest['behavior']
  if (value.behavior !== undefined) {
    const spec = value.behavior as { hooks?: unknown; order?: unknown; permissionMode?: unknown }
    const known = ['beforeTurn', 'afterTurn', 'beforeSteer', 'permission', 'toolCard', 'transcriptCard', 'runtimeEvent'] as const
    const hooks = Array.isArray(spec?.hooks) ? spec.hooks.filter((hook): hook is typeof known[number] => known.includes(hook)) : []
    if (!hooks.length || hooks.length !== (spec.hooks as unknown[]).length) problems.push(`behavior.hooks must list some of ${known.join(', ')}`)
    else if (spec.permissionMode !== undefined && spec.permissionMode !== 'policy' && spec.permissionMode !== 'automation') problems.push('behavior.permissionMode must be policy or automation')
    else behavior = { hooks: [...new Set(hooks)], ...(typeof spec.order === 'number' && Number.isFinite(spec.order) ? { order: spec.order } : {}), ...(spec.permissionMode ? { permissionMode: spec.permissionMode } : {}) }
  }

  const commands: PluginCommandSpec[] = []
  if (value.commands !== undefined && !Array.isArray(value.commands)) problems.push('commands must be a list')
  for (const [index, entry] of (Array.isArray(value.commands) ? value.commands : []).entries()) {
    const command = entry as Record<string, unknown>
    const commandId = typeof command?.id === 'string' ? command.id : ''
    if (!LOCAL_PLUGIN_ID.test(commandId)) { problems.push(`commands[${index}].id is invalid`); continue }
    const scope = command.scope === 'session' || command.scope === 'repository' ? command.scope : 'application'
    const services = Array.isArray(command.services)
      ? command.services.filter((service): service is PluginCommandServiceId => LOCAL_COMMAND_SERVICES.includes(service as PluginCommandServiceId))
      : ['notices' as const]
    const chord = command.tuiChord as { key?: unknown; short?: unknown } | undefined
    const slash = command.composerSlash as { name?: unknown; description?: unknown; argumentHint?: unknown } | undefined
    if (slash && (scope !== 'session' || typeof slash.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(slash.name) || typeof slash.description !== 'string' || !slash.description.trim())) {
      problems.push(`commands[${index}].composerSlash requires a session command, a lowercase name without / and a description`); continue
    }
    commands.push({
      // Namespaced so a mod can never take over a bundled command's id.
      id: `${id}:${commandId}`,
      label: typeof command.label === 'string' && command.label.trim() ? command.label.trim().slice(0, 80) : commandId,
      category: CATEGORIES.includes(command.category as never) ? command.category as PluginCommandSpec['category'] : 'Session',
      handler: commandId,
      scope,
      requires: scope === 'session' ? 'session' : scope === 'repository' ? 'repository' : null,
      renderers: ['web', 'tui'],
      services,
      ...(slash ? { composerSlash: { name: slash.name as string, description: (slash.description as string).slice(0, 200), ...(typeof slash.argumentHint === 'string' ? { argumentHint: slash.argumentHint.slice(0, 100) } : {}) } } : {}),
      ...(Array.isArray(command.keywords) ? { keywords: command.keywords.filter((word): word is string => typeof word === 'string').slice(0, 12) } : {}),
      ...(chord && typeof chord.key === 'string' && /^[a-z0-9]$/.test(chord.key) && typeof chord.short === 'string'
        ? { tuiChord: { key: chord.key, short: chord.short.slice(0, 8) } } : {}),
    })
  }
  const widgets: { id: string; slot: LocalWidgetSlot; refreshMs: number; order?: number }[] = []
  if (value.widgets !== undefined && !Array.isArray(value.widgets)) problems.push('widgets must be a list')
  for (const [index, entry] of (Array.isArray(value.widgets) ? value.widgets : []).entries()) {
    const widget = entry as Record<string, unknown>
    if (typeof widget?.id !== 'string' || !LOCAL_PLUGIN_ID.test(widget.id)) { problems.push(`widgets[${index}].id is invalid`); continue }
    if (widget.slot !== undefined && !LOCAL_WIDGET_SLOTS.includes(widget.slot as LocalWidgetSlot)) { problems.push(`widgets[${index}].slot must be corner, top-center or viewport`); continue }
    if (widget.order !== undefined && (typeof widget.order !== 'number' || !Number.isFinite(widget.order))) { problems.push(`widgets[${index}].order must be finite`); continue }
    const refresh = typeof widget.refreshMs === 'number' && Number.isFinite(widget.refreshMs) ? widget.refreshMs : LOCAL_WIDGET_REFRESH_MS
    widgets.push({ id: widget.id, slot: (widget.slot ?? 'corner') as LocalWidgetSlot, ...(typeof widget.order === 'number' ? { order: widget.order } : {}), refreshMs: Math.max(LOCAL_WIDGET_MIN_REFRESH_MS, Math.min(refresh, 600_000)) })
  }
  let localProvider: { displayName: string } | undefined
  if (value.provider !== undefined) {
    const spec = value.provider as { displayName?: unknown } | null
    if (!spec || typeof spec !== 'object') problems.push('provider must be an object')
    else localProvider = { displayName: typeof spec.displayName === 'string' && spec.displayName.trim() ? spec.displayName.trim().slice(0, 40) : title }
  }
  const views: LocalViewSpec[] = []
  if (value.views !== undefined && !Array.isArray(value.views)) problems.push('views must be a list')
  for (const [index, entry] of (Array.isArray(value.views) ? value.views : []).entries()) {
    const view = entry as Record<string, unknown>
    if (typeof view?.id !== 'string' || !LOCAL_PLUGIN_ID.test(view.id)) { problems.push(`views[${index}].id is invalid`); continue }
    const placements = view.placements === undefined ? ['overlay', 'window'] as const : view.placements
    if (!Array.isArray(placements) || !placements.length || placements.some(placement => !['overlay', 'window', 'panel'].includes(placement as string)) || new Set(placements).size !== placements.length) { problems.push(`views[${index}].placements must list unique overlay, window and/or panel placements`); continue }
    const defaultPlacement = view.defaultPlacement ?? (placements.includes('overlay') ? 'overlay' : 'panel')
    if ((defaultPlacement !== 'overlay' && defaultPlacement !== 'panel') || !placements.includes(defaultPlacement)) { problems.push(`views[${index}].defaultPlacement must be overlay or panel and included in placements`); continue }
    if (view.panelOrder !== undefined && (typeof view.panelOrder !== 'number' || !Number.isFinite(view.panelOrder))) { problems.push(`views[${index}].panelOrder must be finite`); continue }
    views.push({ placements: placements as PluginPlacement[], defaultPlacement, ...(typeof view.panelOrder === 'number' ? { panelOrder: view.panelOrder } : {}), id: view.id, title: typeof view.title === 'string' && view.title.trim() ? view.title.trim().slice(0, 60) : view.id, ...(view.component === true ? { component: true } : {}) })
  }
  if (config && Object.keys(config).length) {
    if (views.some(view => view.id === 'mod-config')) problems.push('mod-config is reserved for generated configuration')
    else views.push({ id: 'mod-config', title: `${title} settings` })
  }
  if (!behavior && toolSpecs.specs.length === 0 && commands.length === 0 && widgets.length === 0 && !localProvider && views.length === 0) problems.push('declares no behavior hooks, commands, widgets, views or provider')
  for (const [kind, entries] of [['commands', commands], ['widgets', widgets], ['views', views]] as const) {
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) problems.push(`${kind} contains duplicate ids`)
  }
  if (problems.length) return { manifest: null, problems }
  // Each view is a surface like any built-in's, opened by its own command: it
  // takes the palette, a window, a tab and a saved layout through the same host.
  const surfaces = views.map(view => ({
    id: localViewSurfaceId(id, view.id), title: view.title, pin: null, single: true, keys: 'window' as const,
    placements: view.placements ?? ['overlay', 'window'] as const, ...(view.panelOrder !== undefined ? { panelOrder: view.panelOrder } : {}), windowLabel: `${view.title} in a window`, services: [], optionalServices: ['notices'] as const,
  }))
  const viewCommands = views.map(view => ({
    id: `${id}:view-${view.id}`, label: view.title, category: 'View' as const, opens: localViewSurfaceId(id, view.id),
    requires: null, scope: 'application' as const, renderers: ['web', 'tui'] as const, ...(view.defaultPlacement === 'panel' ? { placement: 'panel' as const } : {}), keywords: ['mod', title.toLowerCase()],
  }))
  if (new Set([...commands, ...viewCommands].map(command => command.id)).size !== commands.length + viewCommands.length) return { manifest: null, problems: ['command id conflicts with a generated view command'] }
  return {
    manifest: {
      apiVersion: PLUGIN_API_VERSION, id, title, description, ...packageMetadata, renderers: ['web', 'tui'], stateVersion: 1,
      surfaces, commands: [...commands, ...viewCommands], ...(behavior ? { behavior } : {}), ...(toolSpecs.specs.length ? { tools: toolSpecs.specs } : {}), ...(widgets.length ? { widgets, localWidgets: widgets } : {}), ...(localProvider ? { localProvider } : {}), ...(views.length ? { localViews: views } : {}), source: 'local', ...(config ? { config } : {}), ...(appServices.length ? { appServices: [...new Set(appServices)] as ('data' | 'navigation')[] } : {}),
    },
    problems,
  }
}

/** Runs a local command where its code lives: in process (TUI), or through the daemon (Web). */
export type LocalCommandRunner = (request: {
  readonly pluginId: string
  readonly commandId: string
  readonly input?: import('./commands').PluginCommandInput
  readonly target: PluginCommandTarget
  readonly app?: ModAppSnapshot
}, signal: AbortSignal) => Promise<LocalCommandEffects>

let runner: LocalCommandRunner | null = null
/** Each renderer installs its runner once at boot. */
export function setLocalCommandRunner(next: LocalCommandRunner): void { runner = next }

/** The command module the shared command host loads for a local plugin. */
export function localCommandModule(manifest: PluginManifest): PluginCommandModule {
  const handlers = Object.fromEntries(manifest.commands.filter(command => command.handler).map(command => [command.handler!, async ({ target, input, signal, services }: Parameters<PluginCommandModule['handlers'][string]>[0]) => {
    if (!runner) throw new Error('Local plugin commands are unavailable in this host')
    const captured = modAppStore.getSnapshot()
    let effects: LocalCommandEffects
    try { effects = await runner({ pluginId: manifest.id, commandId: command.handler!, target, input, app: captured }, signal) }
    catch (error) { recordModDiagnostic(manifest.id, `command:${command.handler}`, error); throw error }
    signal.throwIfAborted()
    if (!isPluginEnabled(manifest.id)) return
    if (effects.appEffects?.length) await applyModAppEffects(manifest.id, effects.appEffects, captured)
    if (effects.replaceText !== undefined) services.composer?.replaceText(effects.replaceText)
    if (effects.insertText !== undefined) services.composer?.insertText(effects.insertText)
    if (effects.notice) services.notices?.show(effects.notice.kind, effects.notice.text)
  }]))
  return { apiVersion: PLUGIN_API_VERSION, pluginId: manifest.id, handlers }
}

/** Effects decoded from untrusted module output or an HTTP body: anything else is dropped. */
export function decodeLocalCommandEffects(value: unknown): LocalCommandEffects {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const notice = raw.notice as { kind?: unknown; text?: unknown } | string | undefined
  return {
    ...(typeof notice === 'string' ? { notice: { kind: 'info' as const, text: notice.slice(0, 500) } }
      : notice && typeof notice.text === 'string' ? { notice: { kind: notice.kind === 'error' ? 'error' as const : 'info' as const, text: notice.text.slice(0, 500) } } : {}),
    ...(Array.isArray(raw.appEffects) ? { appEffects: raw.appEffects.slice(0, 16).flatMap(effect => { const decoded = decodeModAppEffect(effect); return decoded ? [decoded] : [] }) } : {}),
    ...(typeof raw.insertText === 'string' ? { insertText: raw.insertText } : {}),
    ...(typeof raw.replaceText === 'string' ? { replaceText: raw.replaceText } : {}),
  }
}
