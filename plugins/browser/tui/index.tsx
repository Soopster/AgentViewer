/** @jsxImportSource @opentui/react */
// TUI entry for the Browser plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { BrowserSurfaceView } from './BrowserSurfaceView'

const NOTHING_OPENED: readonly string[] = []
const forget = () => {}

function BrowserSurface({ services, theme, width, height, focused }: TuiPluginViewProps) {
  const location = services['browser-location']
  return (
    <BrowserSurfaceView
      theme={theme}
      width={width}
      height={height}
      focused={focused}
      recent={location?.recent ?? NOTHING_OPENED}
      onOpened={location?.opened ?? forget}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'browser',
  views: { browser: BrowserSurface },
}
