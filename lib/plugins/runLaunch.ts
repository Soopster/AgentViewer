import type { StartProtocolRunParams, StartProtocolRunResult } from '../agentProtocol'
import type { AgentProvider } from '../types'

/** Captured launch defaults and the host-owned lifetime of an accepted run. */
export type PluginRunLaunchService = {
  readonly defaults?: {
    readonly provider: AgentProvider
    readonly providerInstanceId?: string
    readonly model?: string
    readonly effort?: string
    readonly prompt?: string
  }
  /** Cancellation can refuse submission; it cannot undo an accepted run. */
  readonly start: (params: StartProtocolRunParams, signal?: AbortSignal) => Promise<StartProtocolRunResult>
}
