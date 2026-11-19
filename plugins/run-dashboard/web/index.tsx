'use client'

// Web entry for the Run dashboard plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import RunDashboard from './RunDashboard'

function RunDashboardView({ services }: WebPluginViewProps) {
  const fleet = services['session-fleet']!
  return (
    <RunDashboard
      sessions={fleet.sessions}
      selectedSession={fleet.selected}
      messages={fleet.selectedMessages}
      loading={fleet.loading}
      providerLabel={fleet.providerLabel}
      scopeLabel={fleet.scopeLabel}
      onSelectSession={fleet.select}
    />
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'run-dashboard',
  views: { 'run-dashboard': RunDashboardView },
}
