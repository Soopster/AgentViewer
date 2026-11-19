'use client'

// Web entry for the Analytics plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import AnalyticsPopover, { type PaneId } from './AnalyticsView'

function AnalyticsSurface({ services, close, useState }: WebPluginViewProps) {
  const [pane, setPane] = useState<PaneId>('pane', 0)
  return <AnalyticsPopover open onClose={close} input={services['session-transcript'] ?? null} pane={pane} onPaneChange={setPane} />
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'analytics',
  views: { analytics: AnalyticsSurface },
}
