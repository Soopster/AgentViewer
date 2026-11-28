import type { StartProtocolRunResult } from '../../lib/agentProtocol'
import type { PluginRunLaunchService } from '../../lib/plugins/runLaunch'

export function createWebRunLaunchService(fetcher: typeof fetch = (...args) => fetch(...args)): PluginRunLaunchService {
  return {
    async start(params, signal) {
      signal?.throwIfAborted()
      // Dispatch creates an independent runtime. Closing its view must not imply cancellation.
      const response = await fetcher('/api/agent-protocol/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
      })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error(body.error || `Run launch failed (${response.status})`)
      return body as StartProtocolRunResult
    },
  }
}

export const webRunLaunch = createWebRunLaunchService()
