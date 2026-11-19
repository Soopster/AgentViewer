'use client'

// Web entry for Toast notifications: the notification center as floating toasts
// at the top right — what every plugin published through `notifications`. It
// works on its own or beside the dynamic island, as in the terminal.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { PLUGIN_API_VERSION, type PluginWidgetModule } from '@/lib/plugins/types'
import type { WebPluginWidget } from '@/components/shell/pluginTypes'
import { webNotifications } from '@/lib/plugins/notifications'

const TONE: Record<string, string> = { error: 'var(--red, #f85149)', waiting: 'var(--amber, #d29922)', success: 'var(--green, #3fb950)', info: 'var(--border-2)' }

function Toasts() {
  const items = useSyncExternalStore(webNotifications.subscribe, webNotifications.getSnapshot, webNotifications.getServerSnapshot)
  const [now, setNow] = useState(() => Date.now())
  // Expired toasts leave on their own; the feed drops them, this just repaints.
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const visible = items.filter(item => !item.expiresAt || item.expiresAt > now).slice(0, 5)
  if (visible.length === 0) return null
  return (
    <div data-toasts style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
      {visible.map(item => (
        <div key={item.id} role="status" data-toast={item.id}
          style={{ pointerEvents: 'auto', minWidth: 240, maxWidth: 380, background: 'var(--surface)', border: `1px solid ${TONE[item.status] ?? TONE.info}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.25)', display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: TONE[item.status] === TONE.info ? 'var(--text)' : TONE[item.status], wordBreak: 'break-word' }}>{item.title}</div>
            {item.detail ? <div style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.detail}</div> : null}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => webNotifications.service.dismiss(item.id)} style={{ border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', alignSelf: 'flex-start' }}>×</button>
        </div>
      ))}
    </div>
  )
}

export const widgets: PluginWidgetModule<WebPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'toasts', widgets: { toasts: Toasts } }
