'use client'

// Web entry for the Browser plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import BrowserSurface from './BrowserSurface'

const nowhere = () => {}

function BrowserView({ services }: WebPluginViewProps) {
  const location = services['browser-location']
  return (
    <BrowserSurface
      url={location?.url ?? null}
      onUrlChange={location?.navigate ?? nowhere}
      onAttachContext={services.composer?.attachContext}
    />
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'browser',
  views: { browser: BrowserView },
}
