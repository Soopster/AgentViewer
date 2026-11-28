import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginCommandModule } from '../../lib/plugins/commands'
import { formatFocusRemaining, parseFocusDuration } from '../../lib/plugins/focusMode'
import { boundFocusController } from './store'

export const commands: PluginCommandModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'focus-mode',
  // `/focus 45m` starts (or extends) a block, `/focus off` ends it, `/focus` alone starts the default.
  handlers: {
    slash: async ({ services, input }) => {
      const controller = boundFocusController()
      const notices = services.notices
      if (!controller) { notices?.show('error', 'Focus Mode is not running in this window. Turn the plugin on in the plugin manager.'); return }
      const argument = (input?.slash.arguments ?? '').trim()
      if (/^(off|end|stop|done)$/i.test(argument)) {
        await controller.end()
        services.commands?.run('focus-mode')
        return
      }
      const minutes = parseFocusDuration(argument)
      if (minutes === null) { notices?.show('error', `Not a duration: "${argument}". Try /focus 45m, /focus 1h30m or /focus off.`); return }
      await controller.start(minutes)
      const block = controller.getSnapshot().state?.active
      notices?.show('info', `Focusing for ${block ? formatFocusRemaining(block) : `${minutes}m`}. Approvals and questions still come through.`)
    },
  },
}
