'use client'

// Web entry for the Remote access plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import RemoteAccessPopover from './RemoteAccessPopover'

function RemoteAccessView({ close }: WebPluginViewProps) {
  return <RemoteAccessPopover open onClose={close} />
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'remote-access',
  views: { 'remote-access': RemoteAccessView },
}
