'use client'

// Web entry for the Tab manager: the open session tabs in strip order — pin
// one so it leads and cannot be closed by accident, move tabs within their
// group, close or switch to one. The same `session-tabs` contract the TUI's
// strip serves.
import { useEffect } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'

const title = (session: { customTitle?: string; summary?: string; firstPrompt?: string; sessionId: string }) =>
  (session.customTitle || session.summary || session.firstPrompt || session.sessionId).replace(/\s+/g, ' ').trim()

function TabManager({ services, placement, close }: WebPluginViewProps) {
  const tabs = services['session-tabs']!
  const docked = placement !== 'overlay'
  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, close])
  const small = { fontSize: 12, minWidth: 28 }
  const body = (
    <div data-plugin-view="tab-manager" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 600, flex: 1 }}>Tabs · {tabs.sessions.length} open · {tabs.pinned.size} pinned</span>
        {!docked ? <button type="button" aria-label="Close" onClick={close} style={{ fontSize: 12 }}>✕</button> : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 10px' }}>
        {tabs.sessions.length === 0 ? <div style={{ padding: 6, color: 'var(--text-2)' }}>No tabs are open. Open a session to add one.</div>
          : tabs.sessions.map((session, index) => {
            const key = tabs.keyOf(session)
            const pinned = tabs.pinned.has(key)
            const previous = tabs.sessions[index - 1]
            const next = tabs.sessions[index + 1]
            // A tab moves within its group: pinned tabs stay first.
            const canUp = !!previous && tabs.pinned.has(tabs.keyOf(previous)) === pinned
            const canDown = !!next && tabs.pinned.has(tabs.keyOf(next)) === pinned
            return (
              <div key={key} data-tab-row={key} data-pinned={pinned ? 'true' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: key === tabs.selectedKey ? 'var(--surface-3)' : 'transparent' }}>
                <button type="button" aria-label={pinned ? 'Unpin tab' : 'Pin tab'} aria-pressed={pinned} onClick={() => tabs.togglePin(session)}
                  style={{ ...small, color: pinned ? 'var(--cyan)' : 'var(--text-3)' }}>{pinned ? '◆' : '◇'}</button>
                <button type="button" onClick={() => { tabs.select(session); if (!docked) close() }}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', color: 'var(--text)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                  {title(session)} <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{session.provider}</span>
                </button>
                <button type="button" aria-label="Move tab left" disabled={!canUp} onClick={() => tabs.move(session, -1)} style={small}>↑</button>
                <button type="button" aria-label="Move tab right" disabled={!canDown} onClick={() => tabs.move(session, 1)} style={small}>↓</button>
                <button type="button" aria-label="Close tab" disabled={pinned} title={pinned ? 'Unpin to close' : 'Close tab'} onClick={() => tabs.close(session)} style={small}>×</button>
              </div>
            )
          })}
      </div>
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="Tab manager" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={event => event.stopPropagation()} style={{ width: 'min(620px, calc(100vw - 32px))', height: 'min(560px, calc(100vh - 48px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>{body}</div>
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'tab-manager',
  views: { 'tab-manager': TabManager },
}
