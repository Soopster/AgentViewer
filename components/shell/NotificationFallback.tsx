'use client'
import { useSyncExternalStore } from 'react'
import { webActivityFeed } from '../../lib/plugins/activityFeed'
import { webNotifications } from '../../lib/plugins/notifications'
import { useActivityPresentation } from '../../lib/plugins/useActivityFeed'

/** Platform fallback: publishing plugins never need to know which UI is enabled. */
export function NotificationFallback() {
  const presented = useActivityPresentation(webActivityFeed)
  const notifications = useSyncExternalStore(webNotifications.subscribe, webNotifications.getSnapshot, webNotifications.getServerSnapshot)
  if (presented || !notifications.length) return null
  return <aside aria-label="Notifications" style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 50, width: 'min(440px, calc(100vw - 24px))', display: 'flex', flexDirection: 'column', gap: 8 }}>
    {notifications.slice(-4).map(item => <div key={item.id} role={item.status === 'error' ? 'alert' : 'status'} style={{ display: 'flex', gap: 12, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 12, overflowWrap: 'anywhere' }}>
      <div style={{ flex: 1 }}>{item.title}{item.detail ? <div style={{ color: 'var(--text-2)' }}>{item.detail}</div> : null}</div>
      <button type="button" aria-label={`Dismiss ${item.title}`} onClick={() => webNotifications.service.dismiss(item.id)}>×</button>
    </div>)}
  </aside>
}
