import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginCommandModule } from '../../lib/plugins/commands'
import { parseScheduleSlash } from '../../lib/schedules/slash'

export const commands: PluginCommandModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'schedules',
  handlers: {
    // `/schedule every 1h <prompt>` targets the session the command was typed in.
    create: async ({ target, input, services }) => {
      const notices = services.notices!
      const session = target.session
      if (!session) { notices.show('error', '/schedule needs a session'); return }
      const parsed = parseScheduleSlash(input?.slash.arguments ?? '')
      if ('error' in parsed) { notices.show('error', parsed.error); return }
      try {
        await services.schedules!.create({
          name: parsed.prompt.slice(0, 40),
          trigger: parsed.trigger,
          prompt: parsed.prompt,
          ...(parsed.expiresInMs ? { expiresAt: Date.now() + parsed.expiresInMs } : {}),
          action: {
            kind: 'prompt-session',
            sessionId: session.sessionId,
            provider: session.provider ?? 'claude',
            ...(session.providerInstanceId ? { instance: session.providerInstanceId } : {}),
          },
        })
        notices.show('info', `Scheduled: ${parsed.prompt.slice(0, 40)}`)
      } catch (error) {
        notices.show('error', error instanceof Error ? error.message : 'Could not create the schedule')
      }
    },
  },
}
