// Renderer-independent behavior contract. Implementations live in server entries;
// importing these types never loads a provider SDK or a plugin implementation.
import type { AgentProvider } from '../types'
import type { PLUGIN_API_VERSION } from './types'

export type PluginTurnTarget = {
  readonly provider: AgentProvider
  readonly providerInstanceId?: string
  readonly sessionId: string
}

export type PluginBeforeTurnContext = {
  /** Captured before async work. A hook cannot redirect a turn to another account. */
  readonly target: PluginTurnTarget
  readonly signal: AbortSignal
  /** A private copy of the previous hook's result. Return a patch to change it. */
  readonly body: Readonly<Record<string, unknown>>
}

export type PluginBeforeTurnResult =
  | { readonly action: 'patch'; readonly body: Readonly<Record<string, unknown>> }
  | { readonly action: 'block'; readonly reason: string }
  | void

export type PluginBehaviorModule = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly pluginId: string
  readonly beforeTurn: (context: PluginBeforeTurnContext) => PluginBeforeTurnResult | Promise<PluginBeforeTurnResult>
  readonly deactivate?: () => void
}

export class PluginTurnBlockedError extends Error {
  constructor(readonly pluginId: string, reason: string) {
    super(reason)
    this.name = 'PluginTurnBlockedError'
  }
}
