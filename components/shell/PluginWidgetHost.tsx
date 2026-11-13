'use client'

// A Web shell slot for plugin widgets. Each widget has its own error boundary:
// a throwing widget disappears from the slot, the rest and the app stay up.
import React from 'react'
import { usePluginWidgets } from '@/lib/plugins/usePluginWidgets'
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
  if (widgets.length === 0) return null
  return (
    <div data-plugin-widget-slot={slot} style={SLOT_STYLE[slot]}>
      {widgets.map(({ pluginId, id, view: Widget }) => (
        <div key={`${pluginId}:${id}`} data-plugin-widget={`${pluginId}:${id}`} style={{ pointerEvents: 'auto' }}>
          <WidgetBoundary id={`${pluginId}:${id}`}><Widget slot={slot} /></WidgetBoundary>
        </div>
      ))}
    </div>
  )
}
