// Renderer-independent behavior contract. Implementations live in server entries;
// importing these types never loads a provider SDK or a plugin implementation.
import type { AgentProvider, SessionMessage } from '../types'
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

export type PluginAfterTurnContext = {
  /** The session whose turn just settled, provider instance included. */
  readonly target: PluginTurnTarget
  /** Aborted when the plugin is turned off or its host is disposed. */
  readonly signal: AbortSignal
  /** The session's newest messages, read on demand (most hooks never need them). */
  readonly readMessages: (limit?: number) => Promise<SessionMessage[]>
  /** How many plugin follow-ups have run since the user last sent a turn. */
  readonly followUps: number
}

/**
 * 'follow-up' sends one more turn to the same session through the ordinary send
 * path (so every beforeTurn hook sees it). The first contributor to ask wins,
 * and the host stops following up after PLUGIN_FOLLOW_UP_LIMIT in a row.
 */
export type PluginAfterTurnResult =
  | { readonly action: 'follow-up'; readonly message: string }
  | void

export type PluginBeforeSteerContext = {
  readonly target: PluginTurnTarget
  readonly signal: AbortSignal
  /** The text the user is sending into the running turn. */
  readonly message: string
}

/** Rewrite a mid-turn message, or refuse to deliver it (the caller is told why). */
export type PluginBeforeSteerResult =
  | { readonly action: 'patch'; readonly message: string }
  | { readonly action: 'block'; readonly reason: string }
  | void

/**
 * A tool approval an agent is asking for, in one shape for every provider.
 * `kind` says what it is about; `toolName`, `command`, `paths` and `input` say
 * as much as the provider told us.
 */
export type PluginPermissionRequest = {
  readonly kind: 'tool' | 'command' | 'file' | 'network' | 'other'
  readonly toolName?: string
  readonly title?: string
  readonly command?: string
  readonly paths?: readonly string[]
  readonly input?: Readonly<Record<string, unknown>>
}

export type PluginPermissionContext = {
  readonly target: PluginTurnTarget
  readonly signal: AbortSignal
  readonly request: PluginPermissionRequest
}

/**
 * 'allow' or 'deny' answers the agent without asking anyone; returning nothing
 * leaves the decision to the person (or the next plugin). The first plugin to
 * decide wins; a hook that fails or takes longer than PLUGIN_PERMISSION_TIMEOUT_MS
 * is treated as undecided, so a broken plugin can only ever fall back to asking.
 */
export type PluginPermissionResult =
  | { readonly decision: 'allow' | 'deny'; readonly reason?: string }
  | void

export const PLUGIN_PERMISSION_TIMEOUT_MS = 5_000

export type PluginToolCardContext = {
  readonly target: PluginTurnTarget
  readonly tool: { readonly id: string; readonly name: string; readonly input: Readonly<Record<string, unknown>> }
}

/** How a tool call should read in the transcript: a title, a few lines, a tone. Nothing keeps the built-in card. */
export type PluginToolCardResult =
  | { readonly title?: string; readonly lines?: readonly string[]; readonly text?: string; readonly tone?: 'info' | 'success' | 'warning' | 'error' }
  | void
  | null

export type PluginBehaviorHook = 'beforeTurn' | 'afterTurn' | 'beforeSteer' | 'permission' | 'toolCard'

/** Consecutive plugin follow-ups allowed before a user turn resets the count. */
export const PLUGIN_FOLLOW_UP_LIMIT = 25

export type PluginBehaviorModule = {
  readonly apiVersion: typeof PLUGIN_API_VERSION
  readonly pluginId: string
  /** Rewrite or refuse a turn before it reaches the provider. */
  readonly beforeTurn?: (context: PluginBeforeTurnContext) => PluginBeforeTurnResult | Promise<PluginBeforeTurnResult>
  /** Observe a settled turn, and optionally send a follow-up. */
  readonly afterTurn?: (context: PluginAfterTurnContext) => PluginAfterTurnResult | Promise<PluginAfterTurnResult>
  /** Rewrite or refuse a message sent into a running turn. */
  readonly beforeSteer?: (context: PluginBeforeSteerContext) => PluginBeforeSteerResult | Promise<PluginBeforeSteerResult>
  /** Answer a tool approval before it reaches a person. */
  readonly permission?: (context: PluginPermissionContext) => PluginPermissionResult | Promise<PluginPermissionResult>
  /** Present a tool call in the transcript (both renderers). Runs on the read path: keep it cheap and pure. */
  readonly toolCard?: (context: PluginToolCardContext) => PluginToolCardResult | Promise<PluginToolCardResult>
  readonly deactivate?: () => void
}

export class PluginTurnBlockedError extends Error {
  constructor(readonly pluginId: string, reason: string) {
    super(reason)
    this.name = 'PluginTurnBlockedError'
  }
}
