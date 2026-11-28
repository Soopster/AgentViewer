// Renderer-independent behavior contract. Implementations live in server entries;
// importing these types never loads a provider SDK or a plugin implementation.
import type { PluginRuntimeEventContext } from './runtimeEvents'
import type { CardBlock } from './cardBlocks'
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
 * abstains. Policy hooks are all evaluated before automation: any policy deny
 * wins, and a failed/slow policy or explicit ask requires a person. Automation
 * retains first-decision order after policy checks. Hook failures never approve.
 */
export type PluginPermissionResult =
  | { readonly decision: 'allow' | 'deny' | 'ask'; readonly reason?: string }
  | void

export const PLUGIN_PERMISSION_TIMEOUT_MS = 5_000

export type PluginToolCardContext = {
  readonly target: PluginTurnTarget
  readonly tool: { readonly id: string; readonly name: string; readonly input: Readonly<Record<string, unknown>> }
  /** The call's result once it has one (text only, at most PLUGIN_TOOL_RESULT_MAX_CHARS); absent while the call is running. */
  readonly result?: { readonly text: string; readonly isError: boolean; readonly truncated: boolean; /** The result parsed as JSON, from the WHOLE result (a cut-off `text` would not parse), thinned to a bounded size; absent when it is not JSON. */ readonly json?: unknown; readonly structured?: unknown }
}

export const PLUGIN_TOOL_RESULT_MAX_CHARS = 8_000

/** How a tool call should read in the transcript: a title, a few lines, a tone. Nothing keeps the built-in card. */
export type PluginToolCardResult =
  | { readonly title?: string; readonly lines?: readonly string[]; readonly text?: string; readonly blocks?: readonly CardBlock[]; /** Present as a labelled preview BESIDE the built-in card, not instead of it. */ readonly draft?: boolean; readonly ref?: string; readonly tone?: 'info' | 'success' | 'warning' | 'error' }
  | void
  | null

/**
 * A transcript block that is not a tool call: today a system message (a notice, a retry, a status), which the
 * host draws with a generic system card unless a plugin presents it. `payload` is the message as the provider
 * mapper produced it, bounded; the answer is the same title, blocks and tone a tool card gets.
 */
export type PluginTranscriptCardContext = {
  readonly target: PluginTurnTarget
  readonly block: { readonly kind: 'system'; readonly id: string; readonly subtype: string; readonly payload: Readonly<Record<string, unknown>> }
}
export const PLUGIN_TRANSCRIPT_PAYLOAD_MAX_CHARS = 8_000

export type PluginBehaviorHook = 'beforeTurn' | 'afterTurn' | 'beforeSteer' | 'permission' | 'toolCard' | 'transcriptCard' | 'runtimeEvent'

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
  /** Present a non-tool transcript block (a system message) in both renderers. Runs on the read path: keep it cheap and pure. */
  readonly transcriptCard?: (context: PluginTranscriptCardContext) => PluginToolCardResult | Promise<PluginToolCardResult>
  /** Observe runtime metadata; return values cannot mutate or block execution. */
  readonly runtimeEvent?: (context: PluginRuntimeEventContext) => void | Promise<void>
  /** Handlers for the manifest's `tools`, by tool name. */
  readonly tools?: Readonly<Record<string, PluginToolHandler>>
  readonly deactivate?: () => void
}

/** A tool an agent may call. Its result goes to a model, so it is bounded; a thrown error is returned to the agent as text. */
export type PluginToolHandler = (args: Record<string, string | number | boolean>, context: { readonly signal: AbortSignal; /** The calling agent's working directory, when its bridge reported one (an absolute path). */ readonly cwd?: string }) => unknown | Promise<unknown>

export class PluginTurnBlockedError extends Error {
  constructor(readonly pluginId: string, reason: string) {
    super(reason)
    this.name = 'PluginTurnBlockedError'
  }
}
