/** @jsxImportSource @opentui/react */
// TUI widget entry for Pi activity. The shell's corner slot loads it at boot.
import { PLUGIN_API_VERSION, type PluginWidgetModule } from '../../../lib/plugins/types'
import type { TuiPluginWidget } from '../../../tui/opentui/shell/sdk'
import { PiActivityWidget } from './PiActivityWidget'

export const widgets: PluginWidgetModule<TuiPluginWidget> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'pi-activity',
  widgets: { 'pi-activity': PiActivityWidget },
}
