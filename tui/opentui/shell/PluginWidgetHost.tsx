/** @jsxImportSource @opentui/react */
// A TUI shell slot for plugin widgets. The corner is a column at the top-right
// that sizes to what its widgets draw, so an empty slot covers no cells and
// takes no clicks. Each widget has its own error boundary.
import React, { memo } from 'react'
import { usePluginWidgets } from '../../../lib/plugins/usePluginWidgets'
import { useLocalPluginWidgets } from '../../../lib/plugins/useLocalPluginWidgets'
import { fitText } from '../textLayout'
import type { PluginWidgetSlot } from '../../../lib/plugins/types'
import type { TuiThemePalette } from '../../theme'
import { tuiPluginWidgets } from './widgetPlugins'
import type { LoadedPluginWidget } from '../../../lib/plugins/usePluginWidgets'
import type { TuiPluginWidget, TuiPluginWidgetProps } from './pluginTypes'

class WidgetBoundary extends React.Component<{ id: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.error(`Plugin widget ${this.props.id} failed:`, error) }
  render() { return this.state.failed ? null : this.props.children }
}

export const CORNER_WIDGET_MAX_WIDTH = 76

/** A reserved shell row, never an overlay over reader headers or prompts. */
export function TopBarWidgetHost({ widgets, ...props }: Omit<TuiPluginWidgetProps, 'slot'> & {
  widgets: readonly LoadedPluginWidget<TuiPluginWidget>[]
}) {
  if (!widgets.length) return null
  const width = Math.floor(props.width / widgets.length)
  return <box id="plugin-widget-slot:top-bar" width={props.width} height={1} flexShrink={0} flexDirection="row" overflow="hidden">
    {widgets.map(({ pluginId, id, view: Widget }) => <WidgetBoundary key={`${pluginId}:${id}`} id={`${pluginId}:${id}`}>
      <Widget {...props} width={width} height={1} slot="top-bar" />
    </WidgetBoundary>)}
  </box>
}

export const PluginWidgetHost = memo(function PluginWidgetHost({ slot, theme, width, height, zIndex }: {
  slot: PluginWidgetSlot
  theme: TuiThemePalette
  width: number
  height: number
  zIndex: number
}) {
  const widgets = usePluginWidgets('tui', tuiPluginWidgets, slot)
  // Mods' widgets are content from their server module; the shell draws them.
  const local = useLocalPluginWidgets()
  if (widgets.length === 0 && local.length === 0) return null
  const slotWidth = Math.max(20, Math.min(width - 4, CORNER_WIDGET_MAX_WIDTH))
  return (
    <box id={`plugin-widget-slot:${slot}`} position="absolute" top={1} left={Math.max(1, width - slotWidth - 2)} width={slotWidth} zIndex={zIndex} flexDirection="column">
      {widgets.map(({ pluginId, id, view: Widget }) => (
        <WidgetBoundary key={`${pluginId}:${id}`} id={`${pluginId}:${id}`}>
          <Widget slot={slot} theme={theme} width={slotWidth} height={height} />
        </WidgetBoundary>
      ))}
      {local.map(entry => {
        const tone = entry.tone === 'error' ? theme.red : entry.tone === 'warning' ? theme.amber : entry.tone === 'success' ? theme.green : theme.cyan
        return (
          <box key={`local:${entry.pluginId}:${entry.id}`} id={`plugin-widget:${entry.pluginId}:${entry.id}`} width={slotWidth} border borderStyle="single" borderColor={tone}
            backgroundColor={theme.surface} flexDirection="column" paddingX={1} title={` ${fitText(entry.title, slotWidth - 6)} `} titleColor={tone}>
            {entry.lines.map((line, index) => <text key={index} fg={theme.text} wrapMode="none" selectable={false}>{fitText(line, slotWidth - 4) || ' '}</text>)}
          </box>
        )
      })}
    </box>
  )
})
