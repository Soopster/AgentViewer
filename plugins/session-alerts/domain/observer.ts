import type { PluginApplicationContext } from '../../../lib/plugins/application'
import { createSessionAlertTracker, sessionAlertDelivery, sessionAlertText, type SessionAlertMode } from './alerts'

export function createAlertObserver(context: PluginApplicationContext, readMode: () => SessionAlertMode) {
  const tracker = createSessionAlertTracker()
  return {
    onSessionActivity(snapshot: import('../../../lib/plugins/application').PluginActivitySnapshot) {
      const alerts = tracker.observe(snapshot.activity, snapshot.now)
      if (context.signal.aborted) return
      for (const alert of alerts) {
        const session = snapshot.sessions.find(entry => entry.key === alert.key)
        const title = session?.title ?? 'A session'
        const delivery = sessionAlertDelivery(readMode(), snapshot.selectedKey === alert.key, snapshot.focused)
        const text = sessionAlertText(alert.kind, title)
        // A session waiting on the person is never held by a focus block; a finished turn may be.
        const options = { urgent: alert.kind === 'needs-input', ...(session?.target ? { target: session.target } : {}) }
        if (delivery.notice) context.services.notifications?.notice(`${title} ${text.title}`, options)
        if (delivery.desktop) context.services.notifications?.desktop(text.title, text.body.slice(0, 160), options)
      }
    },
  }
}
