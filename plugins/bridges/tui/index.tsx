/** @jsxImportSource @opentui/react */
// TUI entry for the bridge panels: loaded on first open, never at boot. The
// bridges and the composer's routing through them are the host's; a panel
// only shows a bridge's activity and flips the route the host owns.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { ChannelBridgePopover } from './ChannelBridgePopover'
import { IdeBridgePopover } from './IdeBridgePopover'

const NO_NOTICES = () => {}
const UNAVAILABLE = '  Select a Claude session to use the bridge.'

function ChannelBridgeSurface({ services, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const bridge = services['channel-bridge']
  const session = services.session?.session ?? null
  if (!bridge) return <text fg={theme.dim}>{UNAVAILABLE}</text>
  if (!session) return <text fg={theme.dim}>  That session is no longer available.</text>
  return (
    <ChannelBridgePopover
      docked={placement !== 'overlay'}
      theme={theme}
      accentColor={bridge.accentColor}
      width={width}
      height={height}
      routeComposer={bridge.routed}
      targetSessionId={session.sessionId}
      onToggleRoute={bridge.toggleRoute}
      onClose={close}
      onNotice={services.notices?.show ?? NO_NOTICES}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
    />
  )
}

function IdeBridgeSurface({ services, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const bridge = services['ide-bridge']
  if (!bridge) return <text fg={theme.dim}>{UNAVAILABLE}</text>
  return (
    <IdeBridgePopover
      docked={placement !== 'overlay'}
      theme={theme}
      accentColor={bridge.accentColor}
      width={width}
      height={height}
      routeComposer={bridge.routed}
      onToggleRoute={bridge.toggleRoute}
      onClose={close}
      onNotice={services.notices?.show ?? NO_NOTICES}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      onSendComment={bridge.sendComment}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'bridges',
  views: { 'channel-bridge': ChannelBridgeSurface, 'ide-bridge': IdeBridgeSurface },
}
