/** @jsxImportSource @opentui/react */
// TUI entry for the Session insights plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView } from '../../../tui/opentui/shell/sdk'
import { ChangedFilesSurface } from './changed-files/ChangedFilesSurface'
import { ToolTimingSurface } from './tool-timing/ToolTimingSurface'
import { IndexSearchSurface } from './index-search/IndexSearchSurface'

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'session-insights',
  views: { 'changed-files': ChangedFilesSurface, 'tool-timing': ToolTimingSurface, 'index-search': IndexSearchSurface },
}
