// Renderer-independent observation events. They carry metadata, never tool arguments/results or prompt text.
import type { AgentProvider } from '../types'
import type { PluginTurnTarget } from './behavior'
export type PluginRuntimeEvent = {
  readonly type: 'turn.started' | 'turn.settled' | 'tool.started' | 'tool.completed' | 'usage.updated' | 'block.unrendered' | 'ui.interaction'
  readonly target: PluginTurnTarget
  readonly at: number
  readonly source: 'runtime-registry' | 'response-stream' | 'read-path' | 'renderer'
  readonly tool?: { readonly id: string; readonly name?: string; readonly failed?: boolean }
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number }
  /** block.unrendered: the shape of a call no plugin card and no dedicated card drew. Key names, never values. */
  readonly shape?: { readonly tool: string; readonly mcpServer?: string; readonly inputKeys: readonly string[]; readonly resultBytes?: number }
  /** ui.interaction: what a person did to cards of one kind, counted renderer-side since the last report. */
  readonly interaction?: { readonly action: 'expand' | 'fold' | 'toggle' | 'view-switch'; readonly subject: string; readonly count: number }
}
export type PluginRuntimeEventContext = { readonly event: PluginRuntimeEvent; readonly signal: AbortSignal }
export type PluginRuntimeCapabilities = {
  readonly turnLifecycle: 'runtime-registry'
  readonly tools: 'attached-response-stream' | 'unsupported'
  readonly usage: 'attached-response-stream' | 'unsupported'
  /** Fired from the transcript read path, so every renderer and provider is covered. */
  readonly unrenderedBlocks: 'read-path'
  readonly interactions: 'renderer-reports'
  readonly permission: 'provider-approval-requests' | 'unsupported'
  readonly toolInterception: false
  readonly modelRequestRewrite: false
  readonly subagentLifecycle: false
}
const STREAM_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex', 'copilot', 'opencode', 'pi']
const PERMISSION_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex', 'copilot', 'opencode', 'acp', 'claude-acp', 'codex-acp']
/** Reports only the integrations implemented by this host, not theoretical SDK capabilities. */
export function pluginRuntimeCapabilities(provider: AgentProvider): PluginRuntimeCapabilities {
  return Object.freeze({ turnLifecycle: 'runtime-registry', tools: STREAM_PROVIDERS.includes(provider) ? 'attached-response-stream' : 'unsupported', usage: STREAM_PROVIDERS.includes(provider) ? 'attached-response-stream' : 'unsupported', permission: PERMISSION_PROVIDERS.includes(provider) ? 'provider-approval-requests' : 'unsupported', unrenderedBlocks: 'read-path', interactions: 'renderer-reports', toolInterception: false, modelRequestRewrite: false, subagentLifecycle: false })
}
type Listener = (event: PluginRuntimeEvent) => void
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerPluginRuntimeListeners: Set<Listener> | undefined
}
function listeners(): Set<Listener> { return globalThis.__agentViewerPluginRuntimeListeners ??= new Set() }
export function onPluginRuntimeEvent(listener: Listener): () => void { listeners().add(listener); return () => { listeners().delete(listener) } }
export function hasPluginRuntimeObservers(): boolean { return listeners().size > 0 }
export function publishPluginRuntimeEvent(event: Omit<PluginRuntimeEvent, 'at'>): void {
  const frozen = Object.freeze({ ...event, at: Date.now(), target: Object.freeze({ ...event.target }), ...(event.tool ? { tool: Object.freeze({ ...event.tool }) } : {}), ...(event.usage ? { usage: Object.freeze({ ...event.usage }) } : {}) })
  for (const listener of [...listeners()]) { try { listener(frozen) } catch { /* telemetry must never affect a provider turn */ } }
}
