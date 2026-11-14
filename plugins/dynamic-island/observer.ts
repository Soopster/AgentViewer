import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginApplicationModule, PluginSessionActivity } from '../../lib/plugins/application'

export const application: PluginApplicationModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'dynamic-island',
  activate({ services, defer }) {
    const feed = services.activity!
    let previous = new Map<string, PluginSessionActivity>()
    defer(() => feed.removeSource('sessions'))
    return {
      onSessionActivity(snapshot) {
        const sessions = new Map(snapshot.sessions.map(session => [session.key, session]))
        for (const [key, status] of snapshot.activity) {
          const session = sessions.get(key)
          const label = status === 'needs-input' ? 'Needs input' : status === 'waiting' ? 'Waiting' : 'Running'
          feed.publish({ id: `session:${key}`, source: 'sessions', status,
            title: session?.title || 'Agent session', detail: label, target: session?.target })
        }
        for (const key of previous.keys()) {
          if (snapshot.activity.has(key)) continue
          const session = sessions.get(key)
          feed.publish({ id: `session:${key}`, source: 'sessions', status: 'info',
            title: session?.title || 'Agent session', detail: 'Turn ended', target: session?.target, expiresAt: snapshot.now + 6000 })
        }
        previous = new Map(snapshot.activity)
      },
    }
  },
}
