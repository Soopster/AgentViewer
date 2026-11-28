'use client'

// The Web's `top-bar` widget slot: a row above the reader, as the TUI draws its
// top bar above the workspace. Widgets here are handed the shell overview.
import React from 'react'
import { usePluginWidgets } from '@/lib/plugins/usePluginWidgets'
import { webPluginWidgets } from './widgetPlugins'
import { useWebShellOverview, type WebShellActions } from './shellOverviewService'

class Boundary extends React.Component<{ id: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.error(`Plugin widget ${this.props.id} failed:`, error) }
  render() { return this.state.failed ? null : this.props.children }
}

export function WebTopBar(actions: WebShellActions) {
  const widgets = usePluginWidgets('web', webPluginWidgets, 'top-bar')
  const overview = useWebShellOverview(actions)
  if (widgets.length === 0) return null
  return (
    <div data-plugin-widget-slot="top-bar" style={{ flexShrink: 0 }}>
      {widgets.map(({ pluginId, id, view: Widget }) => (
        <Boundary key={`${pluginId}:${id}`} id={`${pluginId}:${id}`}>
          <div data-plugin-widget={`${pluginId}:${id}`}><Widget slot="top-bar" services={{ 'shell-overview': overview }} /></div>
        </Boundary>
      ))}
    </div>
  )
}
