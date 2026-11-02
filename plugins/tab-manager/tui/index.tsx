/** @jsxImportSource @opentui/react */
// TUI entry for the Tab manager plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { TabManagerPopover } from './TabManagerPopover'

function TabManagerSurface({ services, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const fleet = services['session-fleet']!
  if (!fleet.tabs) return <text fg={theme.dim}>  Tabs are not available here.</text>
  return (
    <TabManagerPopover
      docked={placement !== 'overlay'}
      theme={theme}
      width={width}
      height={height}
      tabs={fleet.tabs}
      onSelect={(session) => { if (placement === 'overlay') close(); fleet.open(session) }}
      onClose={close}
      onDetach={detach}
      onKeyHandlerReady={registerKeys}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'tab-manager',
  views: { 'tab-manager': TabManagerSurface },
}
