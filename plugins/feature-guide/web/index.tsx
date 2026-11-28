'use client'

// Web entry for What's new in Agent Viewer: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { FeatureGuideView } from './FeatureGuideView'

function FeatureGuideSurface({ placement, close }: WebPluginViewProps) {
  return <FeatureGuideView docked={placement !== 'overlay'} onClose={close} />
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'feature-guide',
  views: { 'feature-guide': FeatureGuideSurface },
}
