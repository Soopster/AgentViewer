'use client'

// Web entry for the What's new plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { WhatsNewView } from './WhatsNewView'

function WhatsNewSurface({ services, placement, close }: WebPluginViewProps) {
  return <WhatsNewView service={services['whats-new']!} docked={placement !== 'overlay'} onClose={close} />
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'whats-new',
  views: { 'whats-new': WhatsNewSurface },
}
