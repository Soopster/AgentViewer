import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginBehaviorModule } from '../../lib/plugins/behavior'
import { recallProjectMemory } from '../../lib/project-memory/service'
export const behavior: PluginBehaviorModule = { apiVersion: PLUGIN_API_VERSION, pluginId: 'project-memory', async beforeTurn(context) { const message = await recallProjectMemory(context); if (message) return { action: 'patch', body: { message } } } }
