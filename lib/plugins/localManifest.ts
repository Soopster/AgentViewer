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
import { PLUGIN_API_VERSION, type PluginCommandServiceId, type PluginCommandSpec, type PluginManifest } from './types'
import type { PluginCommandModule, PluginCommandTarget } from './commands'

export const LOCAL_PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const LOCAL_COMMAND_SERVICES: readonly PluginCommandServiceId[] = ['notices', 'composer', 'transcript']
const CATEGORIES = ['Session', 'View', 'Transcript', 'Coordination'] as const

/** A validated local plugin manifest, as the catalog and both plugin managers list it. */
export type LocalPluginManifest = PluginManifest & { readonly source: 'local' }

export function isLocalManifest(manifest: PluginManifest): manifest is LocalPluginManifest {
  return (manifest as { source?: unknown }).source === 'local'
}

/** What a local command asks the renderer to do once it returns. */
export type LocalCommandEffects = {
  readonly notice?: { readonly kind: 'info' | 'error'; readonly text: string }
  readonly insertText?: string
  readonly replaceText?: string
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

  let behavior: PluginManifest['behavior']
  if (value.behavior !== undefined) {
    const spec = value.behavior as { hooks?: unknown; order?: unknown }
    const hooks = Array.isArray(spec?.hooks) ? spec.hooks.filter((hook): hook is 'beforeTurn' | 'afterTurn' => hook === 'beforeTurn' || hook === 'afterTurn') : []
    if (!hooks.length || hooks.length !== (spec.hooks as unknown[]).length) problems.push('behavior.hooks must list beforeTurn and/or afterTurn')
    else behavior = { hooks: [...new Set(hooks)], ...(typeof spec.order === 'number' && Number.isFinite(spec.order) ? { order: spec.order } : {}) }
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
      ...(Array.isArray(command.keywords) ? { keywords: command.keywords.filter((word): word is string => typeof word === 'string').slice(0, 12) } : {}),
      ...(chord && typeof chord.key === 'string' && /^[a-z0-9]$/.test(chord.key) && typeof chord.short === 'string'
        ? { tuiChord: { key: chord.key, short: chord.short.slice(0, 8) } } : {}),
    })
  }
  if (!behavior && commands.length === 0) problems.push('declares neither behavior hooks nor commands')
  if (problems.length) return { manifest: null, problems }
  return {
    manifest: {
      apiVersion: PLUGIN_API_VERSION, id, title, description, renderers: ['web', 'tui'], stateVersion: 1,
      surfaces: [], commands, ...(behavior ? { behavior } : {}), source: 'local',
    },
    problems,
  }
}

/** Runs a local command where its code lives: in process (TUI), or through the daemon (Web). */
export type LocalCommandRunner = (request: {
  readonly pluginId: string
  readonly commandId: string
  readonly target: PluginCommandTarget
}, signal: AbortSignal) => Promise<LocalCommandEffects>

let runner: LocalCommandRunner | null = null
/** Each renderer installs its runner once at boot. */
export function setLocalCommandRunner(next: LocalCommandRunner): void { runner = next }

/** The command module the shared command host loads for a local plugin. */
export function localCommandModule(manifest: PluginManifest): PluginCommandModule {
  const handlers = Object.fromEntries(manifest.commands.filter(command => command.handler).map(command => [command.handler!, async ({ target, signal, services }: Parameters<PluginCommandModule['handlers'][string]>[0]) => {
    if (!runner) throw new Error('Local plugin commands are unavailable in this host')
    const effects = await runner({ pluginId: manifest.id, commandId: command.handler!, target }, signal)
    signal.throwIfAborted()
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
    ...(typeof raw.insertText === 'string' ? { insertText: raw.insertText } : {}),
    ...(typeof raw.replaceText === 'string' ? { replaceText: raw.replaceText } : {}),
  }
}
