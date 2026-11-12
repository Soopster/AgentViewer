import { projectComposerContext } from '../../../lib/composerContext'
import type { SendAttachment } from '../../../lib/types'
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import type { PluginBehaviorModule } from '../../../lib/plugins/behavior'

export const behavior: PluginBehaviorModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'composer-context',
  beforeTurn({ body }) {
    try {
      const attachments = Array.isArray(body.attachments)
        ? body.attachments.filter((a): a is SendAttachment => !!a && typeof a === 'object') : []
      const projected = projectComposerContext(String(body.message ?? ''), attachments)
      return { action: 'patch', body: { message: projected.text, attachments: projected.attachments } }
    } catch (error) {
      return { action: 'block', reason: error instanceof Error ? error.message : 'Invalid context' }
    }
  },
}
