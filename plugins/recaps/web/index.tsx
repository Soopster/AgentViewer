'use client'

// Web entry for the Session recaps plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { RecapsSurface } from './RecapsSurface'

function RecapsView({ close }: WebPluginViewProps) {
  return <RecapsSurface onClose={close} />
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'recaps',
  views: { recaps: RecapsView },
}
