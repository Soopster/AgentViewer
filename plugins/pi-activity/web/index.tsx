'use client'

// Web widget entry for Pi activity. The shell's corner slot loads it at boot.
import { PLUGIN_API_VERSION, type PluginWidgetModule } from '@/lib/plugins/types'
import type { WebPluginWidget } from '@/components/shell/pluginTypes'
import { PiActivityWidget } from './PiActivityWidget'

export const widgets: PluginWidgetModule<WebPluginWidget> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'pi-activity',
  widgets: { 'pi-activity': PiActivityWidget },
}
