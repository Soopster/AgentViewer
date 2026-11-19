import type { PluginApplicationContext } from '../../../lib/plugins/application'
import { createSessionAlertTracker, sessionAlertDelivery, sessionAlertText, type SessionAlertMode } from './alerts'

export function createAlertObserver(context: PluginApplicationContext, readMode: () => SessionAlertMode) {
  const tracker = createSessionAlertTracker()
  return {
    onSessionActivity(snapshot: import('../../../lib/plugins/application').PluginActivitySnapshot) {
      const alerts = tracker.observe(snapshot.activity, snapshot.now)
      if (context.signal.aborted) return
      for (const alert of alerts) {
        const title = snapshot.sessions.find(session => session.key === alert.key)?.title ?? 'A session'
        const delivery = sessionAlertDelivery(readMode(), snapshot.selectedKey === alert.key, snapshot.focused)
        const text = sessionAlertText(alert.kind, title)
        if (delivery.notice) context.services.notifications?.notice(`${title} ${text.title}`)
        if (delivery.desktop) context.services.notifications?.desktop(text.title, text.body.slice(0, 160))
      }
    },
  }
}
