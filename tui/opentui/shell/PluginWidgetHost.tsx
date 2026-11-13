/** @jsxImportSource @opentui/react */
// A TUI shell slot for plugin widgets. The corner is a column at the top-right
// that sizes to what its widgets draw, so an empty slot covers no cells and
// takes no clicks. Each widget has its own error boundary.
import React, { memo } from 'react'
import { usePluginWidgets } from '../../../lib/plugins/usePluginWidgets'
import type { PluginWidgetSlot } from '../../../lib/plugins/types'
import type { TuiThemePalette } from '../../theme'
import { tuiPluginWidgets } from './widgetPlugins'

class WidgetBoundary extends React.Component<{ id: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.error(`Plugin widget ${this.props.id} failed:`, error) }
  render() { return this.state.failed ? null : this.props.children }
}

export const CORNER_WIDGET_MAX_WIDTH = 76

export const PluginWidgetHost = memo(function PluginWidgetHost({ slot, theme, width, height, zIndex }: {
  slot: PluginWidgetSlot
  theme: TuiThemePalette
  width: number
  height: number
  zIndex: number
}) {
  const widgets = usePluginWidgets('tui', tuiPluginWidgets, slot)
  if (widgets.length === 0) return null
  const slotWidth = Math.max(20, Math.min(width - 4, CORNER_WIDGET_MAX_WIDTH))
  return (
    <box id={`plugin-widget-slot:${slot}`} position="absolute" top={1} left={Math.max(1, width - slotWidth - 2)} width={slotWidth} zIndex={zIndex} flexDirection="column">
      {widgets.map(({ pluginId, id, view: Widget }) => (
        <WidgetBoundary key={`${pluginId}:${id}`} id={`${pluginId}:${id}`}>
          <Widget slot={slot} theme={theme} width={slotWidth} height={height} />
        </WidgetBoundary>
      ))}
    </box>
  )
})
