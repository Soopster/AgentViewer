import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginCommandModule } from '../../lib/plugins/commands'

export const commands: PluginCommandModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'composer-tools',
  handlers: {
    async reuse({ signal, services }) {
      const messages = await services.transcript!.read(signal)
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message.role !== 'user') continue
        const text = message.blocks.map(block => {
          if (block.type === 'text') return block.text ?? ''
          if (block.type === 'local_command_stdout') return block.stdout ?? ''
          return ''
        }).join('\n').trim()
        if (text) { services.composer!.replaceText(text); return }
      }
    },
  },
}
