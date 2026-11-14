'use client'

// Web entry for the Daily summary plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { DailySummaryView } from './DailySummaryView'

function DailySummarySurface({ services, placement, close }: WebPluginViewProps) {
  const insertText = services.composer?.insertText
  return (
    <DailySummaryView
      service={services['daily-summary']!}
      docked={placement !== 'overlay'}
      onClose={close}
      onDraft={insertText ? (text) => { insertText(text); if (placement === 'overlay') close() } : undefined}
    />
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'daily-summary',
  views: { 'daily-summary': DailySummarySurface },
}
