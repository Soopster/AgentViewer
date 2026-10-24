import type { ProviderComposerConfig } from '../../providerComposer'
import type { SessionCapabilities, AgentProvider, ReasoningEffortLevel, SendAttachment } from '../../types'
import type { SessionAdapter } from '../../adapters/types'
import type { DynamicToolSpec } from '../../codex-schema/v2'
import type { TurnCheckpoint } from '../../checkpoints'

/** Metadata is safe in Web clients and transcript workers. No executable entry here. */
export interface ProviderManifest {
  readonly apiVersion: 1
  readonly id: string
  readonly displayName: string
  readonly assistantLabel: string
  readonly capabilities: SessionCapabilities
  readonly transport: 'native' | 'acp'
  readonly indexable: boolean
  readonly newSession: boolean
  /** True only when SDK state/pools isolate configured instances. */
  readonly supportsInstances: boolean
  readonly composer?: ProviderComposerConfig
  readonly attachments?: {
    readonly types: readonly SendAttachment['type'][]
    readonly remotePaths?: boolean
    readonly imageBlobsOnly?: boolean
  }
}

export type ProviderSessionRequest = {
  sessionId: string
  provider?: AgentProvider
  body: Record<string, unknown>
}

export type ProviderTurnRequest = ProviderSessionRequest & { signal: AbortSignal }
export type ProviderCreateRequest = {
  provider?: AgentProvider
  cwd?: string
  title?: string
  codexDynamicTools?: DynamicToolSpec[]
}
export type ProviderCreatedSession = {
  sessionId: string
  provider: AgentProvider
  cwd: string
  isPending: boolean
}
export type ProviderPrewarmRequest = {
  sessionId: string
  provider?: AgentProvider
  cwd?: string
  model?: string
  effort?: ReasoningEffortLevel
  isPending?: boolean
}

export type ProviderRuntimeTarget = {
  readonly provider: AgentProvider
  readonly providerInstanceId: string
}

/** Invoked inside the host's existing provider-instance request scope.
 * Modules are stateless: SDK pools must key resources by configured instance.
 * AbortSignal and stream cancellation belong to the turn, never a visible view.
 * Missing operations are unsupported; never substitute another provider.
 */
export interface ProviderRuntime {
  createSession(params: ProviderCreateRequest & ProviderRuntimeTarget): Promise<ProviderCreatedSession>
  streamTurn(params: ProviderTurnRequest & ProviderRuntimeTarget, checkpoint?: Promise<TurnCheckpoint | null>): Promise<Response>
  prewarm?(params: ProviderPrewarmRequest & ProviderRuntimeTarget): Promise<void>
  runAction?(params: ProviderSessionRequest & ProviderRuntimeTarget): Promise<Record<string, unknown>>
  forkSession?(params: ProviderSessionRequest & ProviderRuntimeTarget): Promise<{ sessionId: string }>
  rewindSession?(params: ProviderSessionRequest & ProviderRuntimeTarget): Promise<Record<string, unknown>>
  closeSession(sessionId: string, provider: AgentProvider, providerInstanceId: string): Promise<void>
  /** Normalized pending permission/question payloads for the core attention path. */
  listPendingPermissions?(sessionId: string, provider: AgentProvider): Record<string, unknown>[]
}

/** Server-only contribution. Loading reads must never load the turn runtime. */
export interface ProviderExtension {
  readonly manifest: ProviderManifest
  readonly loadAdapter: () => Promise<SessionAdapter>
  readonly loadRuntime: () => Promise<ProviderRuntime>
}
