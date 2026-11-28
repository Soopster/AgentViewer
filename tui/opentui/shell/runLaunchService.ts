import type { PluginRunLaunchService } from '../../../lib/plugins/runLaunch'
import type { StartProtocolRunParams, StartProtocolRunResult } from '../../../lib/agentProtocol'

/** The host owns receipts once accepted, even if the initiating view is gone. */
export function createTuiRunLaunchService(
  start: (params: StartProtocolRunParams) => Promise<StartProtocolRunResult>,
  accepted: (result: StartProtocolRunResult) => void,
  defaults?: PluginRunLaunchService['defaults'],
): PluginRunLaunchService {
  return {
    defaults,
    async start(params, signal) {
      signal?.throwIfAborted()
      const result = await start(params)
      accepted(result)
      return result
    },
  }
}
