/** @jsxImportSource @opentui/react */
import { modAppStore } from '../../../lib/plugins/modApp'
// A TUI shell slot for plugin widgets. The corner is a column at the top-right
// that sizes to what its widgets draw, so an empty slot covers no cells and
// takes no clicks. Each widget has its own error boundary.
import { tuiProof } from './proofService'
import { tuiNotifications } from '../../../lib/plugins/notifications'
import React, { memo, useSyncExternalStore } from 'react'
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
      <Widget {...props} services={{ notifications: tuiNotifications.service, ...props.services }} width={width} height={1} slot="top-bar" />
    </WidgetBoundary>)}
  </box>
}

export const PluginWidgetHost = memo(function PluginWidgetHost({ slot, theme, width, height, zIndex, runCommand }: {
  slot: PluginWidgetSlot
  theme: TuiThemePalette
  width: number
  height: number
  zIndex: number
  runCommand?: (id: string) => void
}) {
  const app = useSyncExternalStore(modAppStore.subscribe, modAppStore.getSnapshot, modAppStore.getSnapshot)
  const repository = app.cwd ? { cwd: app.cwd, sessionId: null } : undefined
  const widgets = usePluginWidgets('tui', tuiPluginWidgets, slot)
  // Mods' widgets are content from their server module; the shell draws them.
  const local = useLocalPluginWidgets(slot === 'corner')
  if (widgets.length === 0 && local.length === 0) return null
  if (slot === 'viewport') return <>{widgets.map(({ pluginId, id, view: Widget }) => <WidgetBoundary key={`${pluginId}:${id}`} id={`${pluginId}:${id}`}><Widget services={{ notifications: tuiNotifications.service, proof: tuiProof, repository }} slot={slot} theme={theme} width={width} height={height} zIndex={zIndex} runCommand={runCommand} /></WidgetBoundary>)}</>
  const slotWidth = Math.max(1, Math.min(width - 4, slot === 'top-center' ? 56 : CORNER_WIDGET_MAX_WIDTH))
  return (
    <box id={`plugin-widget-slot:${slot}`} position="absolute" top={slot === 'top-center' ? 0 : 1} left={slot === 'top-center' ? Math.max(0, Math.floor((width - slotWidth) / 2)) : Math.max(0, width - slotWidth - 2)} width={slotWidth} zIndex={zIndex} flexDirection="column" alignItems={slot === 'top-center' ? 'center' : undefined}>
      {widgets.map(({ pluginId, id, view: Widget }) => (
        <WidgetBoundary key={`${pluginId}:${id}`} id={`${pluginId}:${id}`}>
          <Widget services={{ notifications: tuiNotifications.service, proof: tuiProof, repository }} runCommand={runCommand} slot={slot} theme={theme} width={slotWidth} height={height} />
        </WidgetBoundary>
      ))}
      {slot === 'corner' ? local.map(entry => {
        const tone = entry.tone === 'error' ? theme.red : entry.tone === 'warning' ? theme.amber : entry.tone === 'success' ? theme.green : theme.cyan
        return (
          <box key={`local:${entry.pluginId}:${entry.id}`} id={`plugin-widget:${entry.pluginId}:${entry.id}`} width={slotWidth} border borderStyle="single" borderColor={tone}
            backgroundColor={theme.surface} flexDirection="column" paddingX={1} title={` ${fitText(entry.title, slotWidth - 6)} `} titleColor={tone}>
            {entry.lines.map((line, index) => <text key={index} fg={theme.text} wrapMode="none" selectable={false}>{fitText(line, slotWidth - 4) || ' '}</text>)}
          </box>
        )
      }) : null}
    </box>
  )
})
