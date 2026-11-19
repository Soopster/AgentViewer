/** @jsxImportSource @opentui/react */
// TUI entry for the Session alerts plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { SessionAlertsPopover } from './SessionAlertsPopover'

function SessionAlertsSurface({ theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  return <SessionAlertsPopover docked={placement !== 'overlay'} theme={theme} width={width} height={height} onClose={close} onDetach={detach} onKeyHandlerReady={registerKeys} />
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'session-alerts',
  views: { 'session-alerts': SessionAlertsSurface },
}
