'use client'

// Web entry for the Terminal plugin: its own chunk (with the terminal
// emulator), loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import TerminalView from './TerminalView'

function TerminalSurface({ services }: WebPluginViewProps) {
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
      <TerminalView onAttachContext={services.composer?.attachContext} />
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'terminal',
  views: { terminal: TerminalSurface },
}
