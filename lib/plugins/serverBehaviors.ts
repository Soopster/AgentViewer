// Server-only registration list. Metadata consumers must never import this file.
//
// It is also where behavior plugins meet the session runtime: beforeTurn runs
// on the shared send path (lib/sessionBackend.ts), and afterTurn runs off the
// runtime's turn-settled event, so every provider and every surface (Web, TUI,
// a goal continuation, a plugin's own follow-up) reaches both.
import { isResearchSession } from '../sessionResearchPolicy'
import { PLUGIN_MANIFESTS } from './catalog'
import { createPluginBehaviorHost } from './behaviorHost'
import { applyPluginSettings } from './enablement'
import { readPluginSettingsFile } from './settingsFile'
import { PLUGIN_FOLLOW_UP_LIMIT, type PluginBeforeTurnContext, type PluginPermissionRequest, type PluginTurnTarget } from './behavior'
import type { PluginBehaviorModule } from './behavior'
import type { PluginManifest } from './types'
import { localPluginDiscovery } from './localPlugins'
import { localBehaviorLoaders } from './localPluginRuntime'

/** Field a plugin follow-up turn carries; stripped before the provider sees the body. */
export const PLUGIN_FOLLOW_UP_FIELD = 'pluginFollowUp'
/** Transcript writes land just after the running entry clears, as for goals. */
const SETTLE_DELAY_MS = 2_000

type BehaviorState = {
  host: ReturnType<typeof createPluginBehaviorHost> | null
  installed: boolean
  followUps: Map<string, number>
  timers: Map<string, ReturnType<typeof setTimeout>>
}

declare global {
  // The settle listener outlives a Next dev reload with the runtime it observes.
  // eslint-disable-next-line no-var
  var __agentViewerPluginBehaviorState: BehaviorState | undefined
}

const BUNDLED_BEHAVIORS: Record<string, () => Promise<PluginBehaviorModule>> = {
  'composer-context': async () => (await import('../../plugins/composer-context/server')).behavior,
}

function state(): BehaviorState {
  globalThis.__agentViewerPluginBehaviorState ??= { host: null, installed: false, followUps: new Map(), timers: new Map() }
  return globalThis.__agentViewerPluginBehaviorState
}

/** The process's behavior host, for read-path consumers (tool cards). */
export function pluginBehaviorHost() {
  applyPluginSettings(readPluginSettingsFile())
  return host()
}

function host() {
  const current = state()
  if (!current.host) {
    // Local plugins (the user's mods) join the bundled behaviors in one ordered pipeline.
    const local = localPluginDiscovery().plugins.map(plugin => plugin.manifest).filter(manifest => manifest.behavior)
    current.host = createPluginBehaviorHost([...(PLUGIN_MANIFESTS as readonly PluginManifest[]), ...local], { ...BUNDLED_BEHAVIORS, ...localBehaviorLoaders() })
  }
  return current.host
}

const targetKey = (target: PluginTurnTarget) => `${target.provider}@${target.providerInstanceId ?? ''}:${target.sessionId}`

export async function applyPluginBeforeTurn(context: PluginBeforeTurnContext): Promise<Record<string, unknown>> {
  // Catch changes from another Web/TUI process before activating anything.
  applyPluginSettings(readPluginSettingsFile())
  installSettledTurnObserver()
  const fromPlugin = typeof context.body[PLUGIN_FOLLOW_UP_FIELD] === 'string'
  // A turn the user sent ends any run of plugin follow-ups.
  if (!fromPlugin) state().followUps.delete(targetKey(context.target))
  const body = await host().beforeTurn(context)
  delete body[PLUGIN_FOLLOW_UP_FIELD]
  return body
}

/** Idempotent. Registered on the first send, which is when the send path is loaded. */
function installSettledTurnObserver(): void {
  const current = state()
  if (current.installed) return
  current.installed = true
  void import('../sessionRuntime').then(({ onTurnSettled }) => onTurnSettled((event) => {
    if (!host().observesSettledTurns()) return
    const target: PluginTurnTarget = { provider: event.provider, sessionId: event.sessionId, ...(event.providerInstanceId ? { providerInstanceId: event.providerInstanceId } : {}) }
    if (isResearchSession(target)) return
    const key = targetKey(target)
    const existing = current.timers.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => { current.timers.delete(key); void runAfterTurn(target) }, SETTLE_DELAY_MS)
    if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref()
    current.timers.set(key, timer)
  }))
}

async function runAfterTurn(target: PluginTurnTarget): Promise<void> {
  applyPluginSettings(readPluginSettingsFile())
  const { getRunningSession } = await import('../sessionRuntime')
  // Another turn started in the settle window: it will settle again.
  if (getRunningSession(target.sessionId, { provider: target.provider, providerInstanceId: target.providerInstanceId })) return
  const key = targetKey(target)
  const followUps = state().followUps.get(key) ?? 0
  const scoped = async <T,>(run: () => Promise<T>): Promise<T> => {
    if (!target.providerInstanceId) return run()
    const { withProviderInstance } = await import('../providerInstances')
    return withProviderInstance(target.providerInstanceId, target.provider, run)
  }
  const readMessages = async (limit = 200) => scoped(async () => {
    const { listViewSessionMessages } = await import('../sessionReads')
    return listViewSessionMessages(target.sessionId, { limit: Math.max(1, Math.min(limit, 2_000)), offset: 0, tail: true }, target.provider)
  })
  const followUp = await host().afterTurn({ target, readMessages, followUps })
  if (!followUp) return
  if (followUps >= PLUGIN_FOLLOW_UP_LIMIT) {
    console.warn(`[plugins] ${followUp.pluginId} asked for a follow-up after ${followUps} in a row; stopping until the user sends a turn`)
    return
  }
  state().followUps.set(key, followUps + 1)
  try {
    await scoped(async () => {
      const { streamViewSessionTurn } = await import('../sessionBackend')
      const response = await streamViewSessionTurn({
        sessionId: target.sessionId,
        provider: target.provider,
        signal: new AbortController().signal,
        body: { message: followUp.message, [PLUGIN_FOLLOW_UP_FIELD]: followUp.pluginId },
      })
      if (!response.ok) throw new Error((await response.text().catch(() => '')) || `Follow-up rejected (${response.status})`)
      // Drain the stream so the provider actually runs the turn.
      const reader = response.body?.getReader()
      if (reader) while (!(await reader.read()).done) { /* drain */ }
    })
  } catch (error) {
    console.error(`[plugins] ${followUp.pluginId} follow-up failed:`, error)
  }
}

/** Plugins' say on a message sent into a running turn: the rewritten text, or a PluginTurnBlockedError. */
export async function applyPluginBeforeSteer(target: PluginTurnTarget, message: string, signal: AbortSignal = new AbortController().signal): Promise<string> {
  applyPluginSettings(readPluginSettingsFile())
  if (!host().observesSteering()) return message
  return host().beforeSteer({ target, signal, message })
}

/**
 * Ask plugins about a tool approval before a person sees it. Null means ask the
 * person. Every provider's approval bridge calls this, so a plugin's policy
 * holds whichever agent is running.
 */
export async function decidePermissionByPlugins(target: PluginTurnTarget, request: PluginPermissionRequest, signal?: AbortSignal): Promise<{ pluginId: string; decision: 'allow' | 'deny'; reason?: string } | null> {
  applyPluginSettings(readPluginSettingsFile())
  if (!host().decidesPermissions()) return null
  const decided = await host().permission({ target, request, signal })
  if (decided) console.info(`[plugins] ${decided.pluginId} ${decided.decision === 'allow' ? 'approved' : 'denied'} ${request.toolName ?? request.kind}${decided.reason ? `: ${decided.reason}` : ''}`)
  return decided
}
