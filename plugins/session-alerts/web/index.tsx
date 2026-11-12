'use client'
import { useEffect, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '../../../components/shell/pluginTypes'
import { setSessionAlertMode, useSessionAlertMode } from './modeStore'

function SessionAlertsSurface({ placement, close }: WebPluginViewProps) {
  const mode = useSessionAlertMode()
  const [permission, setPermission] = useState(() => typeof Notification === 'undefined' ? 'unavailable' : Notification.permission)
  const initialFocus = useRef<HTMLButtonElement>(null)
  useEffect(() => { initialFocus.current?.focus() }, [])
  const content = <div role="dialog" aria-label="Session alerts" aria-modal={placement === 'overlay'}
    onKeyDown={event => { if (event.key === 'Escape') close() }}
    style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, color: 'var(--text)', maxWidth: 500 }}>
    <h2 style={{ marginTop: 0 }}>Session alerts</h2>
    <p>Notify when another session needs input or a turn lasting at least 15 seconds finishes.</p>
    <div role="group" aria-label="Alert delivery" style={{ display: 'flex', gap: 8 }}>
      {(['off', 'in-app', 'desktop'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setSessionAlertMode(value)}>{value}</button>)}
    </div>
    <p>Desktop notifications are used while this app is in the background. Browser permission: {permission}.</p>
    {permission === 'default' && <button type="button" onClick={() => { void Notification.requestPermission().then(setPermission) }}>Allow desktop notifications</button>}
    <button type="button" ref={initialFocus} onClick={close}>Close</button>
  </div>
  return placement === 'overlay'
    ? <div onPointerDown={event => { if (event.target === event.currentTarget) close() }} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)' }}>{content}</div>
    : content
}
export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'session-alerts', views: { 'session-alerts': SessionAlertsSurface },
}
