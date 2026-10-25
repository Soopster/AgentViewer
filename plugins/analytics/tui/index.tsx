/** @jsxImportSource @opentui/react */
// TUI entry for the Analytics plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { AnalyticsPopover, type PaneId } from './AnalyticsView'

function AnalyticsSurface({ services, theme, width, height, placement, useState, registerKeys, close, detach }: TuiPluginViewProps) {
  const transcript = services['session-transcript']
  const [pane, setPane] = useState<PaneId>('pane', 0)
  const docked = placement === 'window'
  if (docked && transcript?.status === 'gone') return <text fg={theme.dim}>  That session is no longer available.</text>
  if (docked && !transcript?.detail) return <text fg={theme.dim}>{transcript?.status === 'error' ? '  Could not read the session.' : '  Loading…'}</text>
  return (
    <AnalyticsPopover
      docked={docked}
      detail={transcript?.detail ?? null}
      theme={theme}
      width={width}
      height={height}
      onClose={close}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      pane={pane}
      onPaneChange={setPane}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'analytics',
  views: { analytics: AnalyticsSurface },
}
