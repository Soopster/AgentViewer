import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginBehaviorModule } from '../../lib/plugins/behavior'
import { captureSettledPlan } from '../../lib/plan-review/service'
export const behavior: PluginBehaviorModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'plan-review',
  async afterTurn({ target, readMessages, signal }) {
    await captureSettledPlan(target, await readMessages(200), signal)
  },
}
