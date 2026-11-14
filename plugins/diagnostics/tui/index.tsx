/** @jsxImportSource @opentui/react */
// TUI entry for the Session diagnostics plugin: loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView } from '../../../tui/opentui/shell/sdk'
import { DiagnosticsView } from './DiagnosticsView'

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'diagnostics',
  views: { diagnostics: DiagnosticsView },
}
