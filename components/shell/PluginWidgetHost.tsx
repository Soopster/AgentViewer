'use client'

// A Web shell slot for plugin widgets. Each widget has its own error boundary:
// a throwing widget disappears from the slot, the rest and the app stay up.
import React from 'react'
import { usePluginWidgets } from '@/lib/plugins/usePluginWidgets'
import { useLocalPluginWidgets } from '@/lib/plugins/useLocalPluginWidgets'
import type { PluginWidgetSlot } from '@/lib/plugins/types'
import { webPluginWidgets } from './widgetPlugins'

class WidgetBoundary extends React.Component<{ id: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.error(`Plugin widget ${this.props.id} failed:`, error) }
  render() { return this.state.failed ? null : this.props.children }
}

const SLOT_STYLE: Record<PluginWidgetSlot, React.CSSProperties> = {
  corner: { position: 'fixed', right: 20, bottom: 20, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, pointerEvents: 'none' },
}

export function PluginWidgetHost({ slot }: { slot: PluginWidgetSlot }) {
  const widgets = usePluginWidgets('web', webPluginWidgets, slot)
  // Mods' widgets are content from their server module; the shell draws them.
  const local = useLocalPluginWidgets()
  if (widgets.length === 0 && local.length === 0) return null
  return (
    <div data-plugin-widget-slot={slot} style={SLOT_STYLE[slot]}>
      {widgets.map(({ pluginId, id, view: Widget }) => (
        <div key={`${pluginId}:${id}`} data-plugin-widget={`${pluginId}:${id}`} style={{ pointerEvents: 'auto' }}>
          <WidgetBoundary id={`${pluginId}:${id}`}><Widget slot={slot} /></WidgetBoundary>
        </div>
      ))}
      {local.map(entry => (
        <div key={`local:${entry.pluginId}:${entry.id}`} data-plugin-widget={`${entry.pluginId}:${entry.id}`}
          style={{ pointerEvents: 'auto', minWidth: 200, maxWidth: 360, background: 'var(--surface)', border: `1px solid ${LOCAL_TONE[entry.tone]}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
          <div style={{ fontWeight: 600, color: LOCAL_TONE[entry.tone], marginBottom: 4 }}>{entry.title}</div>
          {entry.lines.map((line, index) => <div key={index} style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{line || '\u00a0'}</div>)}
        </div>
      ))}
    </div>
  )
}

const LOCAL_TONE = { info: 'var(--border-2)', success: 'var(--green, #3fb950)', warning: 'var(--amber, #d29922)', error: 'var(--red, #f85149)' } as const
